const fs = require('fs');
const key = fs.readFileSync('./ticket-bari-7a7cf-firebase-adminsdk-fbsvc-9fca243322.json', 'utf8')
const base64 = Buffer.from(key).toString('base64')
console.log(base64)