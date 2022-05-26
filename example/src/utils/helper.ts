import { trim } from 'lodash'

/**
 * Returns uglyfied raw SQL query
 * @param {string} formattedRawSqlQuery Formatted raw SQL query (single/multi line comments, tabs, new lines)
 * @returns {string} Uglyfied raw SQL query (without single/multi line comments, tabs, new lines)
 */
export const uglyfyRawSqlQuery = (formattedRawSqlQuery: string | null) => {
	return trim(
		formattedRawSqlQuery
			?.replace(/.*--.*\n/g, '')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/\t/g, '')
			.replace(/\n/g, ' ')
			.replace(/ {2,}/g, ' ')
	)
}
