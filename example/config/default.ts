import { IConfig } from '../src/types/config'

export default <Partial<IConfig>>{
	aws: {
		s3: {
			accessKeyID: process.env.AWS_S3_ACCESS_KEY_ID,
			secretAccessKey: process.env.AWS_S3_SECRET_KEY,
			region: process.env.AWS_S3_REGION,
			bucket: process.env.AWS_S3_BUCKET
		}
	}
}
