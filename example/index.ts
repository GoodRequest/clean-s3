import cleaner from '../cleaner'

export default (async () => {
	console.log('Running cleaner')

	const cleanResult = await cleaner()

	console.log('Clean finished: ', JSON.stringify(cleanResult))
})()
