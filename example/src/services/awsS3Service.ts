import { S3Client } from '@aws-sdk/client-s3'
import config from 'config'

// types
import { IAwsConfig } from '../types/config'

const awsConfig: IAwsConfig = config.get('aws')

const s3Client = new S3Client({
	credentials: {
		accessKeyId: awsConfig.s3.accessKeyID,
		secretAccessKey: awsConfig.s3.secretAccessKey
	},
	region: awsConfig.s3.region
})

export { s3Client }
