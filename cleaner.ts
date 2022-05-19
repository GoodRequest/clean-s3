import { QueryTypes } from 'sequelize'
import { find, forEach, map, reduce, replace } from 'lodash'
import dayjs from 'dayjs'
import { DeleteObjectsCommand } from '@aws-sdk/client-s3'
import config from 'config'

import sequelize from '../notino_backend/src/db/models'

// utils
import { uglyfyRawSqlQuery } from '../notino_backend/src/utils/helper'

// services
import { s3Client } from '../notino_backend/src/services/awsS3Service'

// types
import { IAwsConfig } from '../notino_backend/src/types/config'

const awsConfig: IAwsConfig = config.get('aws')

const markFilesForDeletion = async (filesTableName: string, primaryKeyColumnName: string) => {
	// get all associations where file is foreign key
	const rawAssociations: any[] = await sequelize.query(
		uglyfyRawSqlQuery(/* SQL */ `
			SELECT
				"tc"."constraint_name",
				--"tc"."table_schema",
				"tc"."table_name",
				"kcu"."column_name"
				--"ccu"."table_schema" AS "foreign_table_schema",
				--"ccu"."table_name" AS "foreign_table_name",
				--"ccu"."column_name" AS "foreign_column_name"
			FROM
				"information_schema"."table_constraints" AS "tc"
			INNER JOIN "information_schema"."key_column_usage" AS "kcu" ON "tc"."constraint_name" = "kcu"."constraint_name"
				AND ( "tc"."table_schema" = "kcu"."table_schema" )
			INNER JOIN "information_schema"."constraint_column_usage" AS "ccu" ON "ccu"."constraint_name" = "tc"."constraint_name"
				AND ( "ccu"."table_schema" = "tc"."table_schema" )
			WHERE
				"tc"."constraint_type" = 'FOREIGN KEY'
				AND "ccu"."table_name" = '${filesTableName}'
		`),
		{
			type: QueryTypes.SELECT
		}
	)

	const associatedTablesDescribeData = await Promise.all(map(rawAssociations, (rawAssociation) => sequelize.getQueryInterface().describeTable(rawAssociation.table_name)))

	// check if files table has associations
	const associations = map(rawAssociations, (rawAssociation, index) => ({
		table: rawAssociation.table_name as string,
		as: rawAssociation.constraint_name as string,
		fileColumn: rawAssociation.column_name as string,
		hasDeletedAt: !!associatedTablesDescribeData[index].deletedAt
	}))
	if (associations.length === 0) {
		throw new Error('Files table does not contain any associations')
	}

	// get files which are unused (does not have any association)
	const unusedFilesResult = await sequelize.query(
		uglyfyRawSqlQuery(/* SQL */ `
			UPDATE "${filesTableName}"
			SET "deletedAt" = now()
			FROM (
				SELECT
					"${filesTableName}"."${primaryKeyColumnName}"
				FROM "${filesTableName}"
				${map(
					associations,
					(association) =>
						`
							LEFT OUTER JOIN "${association.table}" AS "${association.as}" ON "${filesTableName}"."${primaryKeyColumnName}" = "${association.as}"."${association.fileColumn}"
						`
				).join('\n')}
				WHERE
					"${filesTableName}"."deletedAt" IS NULL
					${
						associations.length > 0
							? ` AND
								${map(associations, (association) => `"${association.as}"."${association.fileColumn}" IS NULL`).join(' AND ')}
							`
							: ''
					}
			)  AS "unusedFile"
			WHERE "${filesTableName}"."${primaryKeyColumnName}" = "unusedFile"."${primaryKeyColumnName}"
		`),
		{
			type: QueryTypes.UPDATE
		}
	)

	return { unused: unusedFilesResult[1] ?? 0 }
}

const removeFiles = async (filesTableName: string, primaryKeyColumnName: string, keyColumnName: string, keyColumnBase: string) => {
	const errors: any[] = []
	let removed = 0

	const limit = 1000

	// get count all files which should be deleted at current date (they were deleted before 30 days from today)
	const deleteFilesCountResult: any[] = await sequelize.query(
		uglyfyRawSqlQuery(/* SQL */ `
			SELECT
				COUNT( "${filesTableName}"."${primaryKeyColumnName}" ) AS "count"
			FROM "${filesTableName}"
			WHERE
				"${filesTableName}"."deletedAt" <= '${dayjs().subtract(30, 'days').toISOString()}'
		`),
		{
			type: QueryTypes.SELECT
		}
	)

	const deleteFilesCount = deleteFilesCountResult[0]?.count ?? 0
	const chunkCount = Math.ceil(deleteFilesCount / limit)
	const pages = map(Array.from(Array(chunkCount)), (_value, index) => index + 1)

	await reduce(
		pages,
		(promise: Promise<any>, page) => {
			return promise.then(async () => {
				const offset = page * limit - limit

				// get all files which should be deleted at current date (they were deleted before 30 days from today)
				const deleteFiles: any[] = await sequelize.query(
					uglyfyRawSqlQuery(/* SQL */ `
						SELECT
							"${filesTableName}"."${primaryKeyColumnName}",
							"${filesTableName}"."${keyColumnName}"
						FROM "${filesTableName}"
						WHERE
							"${filesTableName}"."deletedAt" <= '${dayjs().subtract(30, 'days').toISOString()}'
						ORDER BY "${filesTableName}"."${primaryKeyColumnName}" ASC
						LIMIT ${limit} OFFSET ${offset}
					`),
					{
						type: QueryTypes.SELECT
					}
				)

				// remove files which are marked for delete at current date (s3)
				const s3DeleteObjects = map(deleteFiles, (deleteFile) => ({ Key: replace(deleteFile.path, new RegExp(keyColumnBase), '') }))
				const awsRemovedKeys: string[] = []

				const command = new DeleteObjectsCommand({
					Bucket: awsConfig.s3.bucket,
					Delete: {
						Objects: s3DeleteObjects
					}
				})
				const deleteResult = await s3Client.send(command)

				forEach(deleteResult.Deleted, (deletedObject) => {
					if (deletedObject?.Key) {
						awsRemovedKeys.push(deletedObject.Key)
					}
				})

				forEach(deleteResult.Errors, (error) => {
					errors.push(error)
				})

				removed += deleteResult.Deleted?.length || 0

				if (awsRemovedKeys.length > 0) {
					// remove files which are marked for delete at current date and were removed in aws (db)
					const dbDeleteFilePaths = map(awsRemovedKeys, (awsRemovedKey) => `${keyColumnBase}${awsRemovedKey}`)

					await sequelize.query(
						uglyfyRawSqlQuery(/* SQL */ `
							DELETE
							FROM "${filesTableName}"
							WHERE
								"${filesTableName}"."${keyColumnName}" IN ( :dbDeleteFilePaths )
						`),
						{
							type: QueryTypes.DELETE,
							replacements: {
								dbDeleteFilePaths
							}
						}
					)
				}

				return Promise.resolve()
			})
		},
		Promise.resolve()
	)

	return {
		errors,
		removed
	}
}

export default (async () => {
	try {
		const filesTableName = process.env.S3_CLEANUP_FILES_TABLE_NAME
		if (!filesTableName) {
			throw new Error('S3_CLEANUP_FILES_TABLE_NAME env not provided')
		}

		const keyColumnName = process.env.S3_CLEANUP_KEY_COLUMN_NAME
		if (!keyColumnName) {
			throw new Error('S3_CLEANUP_KEY_COLUMN_NAME env not provided')
		}

		const keyColumnBase = process.env.S3_CLEANUP_KEY_COLUMN_BASE || ''

		const filesTableDescribeData = await sequelize.getQueryInterface().describeTable(filesTableName)

		// check if files table has primaryKey
		const columns = map(filesTableDescribeData, (column, columnName) => ({
			...column,
			name: columnName
		}))
		const primaryKeyColumnName = find(columns, (column) => column.primaryKey === true)?.name
		if (!primaryKeyColumnName) {
			throw new Error('Files table does not have primary key')
		}

		// check if files table has provided colunm
		if (!filesTableDescribeData[keyColumnName]) {
			throw new Error('Files table does not have keyColumnName')
		}

		// check if files table has deletedAt column
		if (!filesTableDescribeData.deletedAt) {
			throw new Error('Files table does not have deletedAt column!')
		}

		// NOTE: mark for deletion files which are not used (they do not have any association)
		const unused = await markFilesForDeletion(filesTableName, primaryKeyColumnName)

		// NOTE: delete (from db and s3) files which were mark for deletion 30 days ago
		const removedData = await removeFiles(filesTableName, primaryKeyColumnName, keyColumnName, keyColumnBase)

		return {
			unused,
			deleted: removedData.removed,
			errors: removedData.errors
		}
	} catch (error) {
		return Promise.reject(error)
	}
})()
