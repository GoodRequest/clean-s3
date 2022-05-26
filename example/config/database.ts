import 'dotenv/config'

import { IDatabaseConfig } from '../src/types/config'

export const development: IDatabaseConfig = {
	url: process.env.POSTGRESQL_URL || '',
	options: {
		minifyAliases: true,
		logging: false,
		pool: {
			max: 4
		}
	}
}

