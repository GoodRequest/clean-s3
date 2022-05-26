import { Sequelize } from 'sequelize'

import * as database from '../../../config/database'

const { url, options: dbOptions } = database['development']

const sequelize = new Sequelize(url, dbOptions)
sequelize
	.authenticate()
	.then(() => console.log('Database connection has been established successfully'))
	.catch((err) => console.log(`Unable to connect to the database: ${err}`))

export default sequelize
