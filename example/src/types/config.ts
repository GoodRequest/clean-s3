import { Options } from 'sequelize'

export interface IAwsConfig {
	s3: {
		accessKeyID: string
		secretAccessKey: string
		region: string
		bucket: string
	}
}

export interface IConfig {
	aws: IAwsConfig
}

export interface IDatabaseConfig {
	url: string
	options: Options
}
