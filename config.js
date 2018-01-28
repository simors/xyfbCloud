
//rabbitMQ配置
export const RABBITMQ_URL = process.env.RABBITMQ_URL

// mysql数据库配置
export const MYSQL_HOST = process.env.MYSQL_HOST
export const MYSQL_USER = process.env.MYSQL_USER
export const MYSQL_PWD = process.env.MYSQL_PWD
export const MYSQL_DB = process.env.MYSQL_DB

//Ping++应用配置
export const PINGPP_APP_ID = process.env.PINGPP_APP_ID
export const PINGPP_API_KEY = process.env.PINGPP_API_KEY      //Secret Key

//redis配置
export const REDIS_URL = process.env.REDIS_URL
export const REDIS_PORT = process.env.REDIS_PORT
export const REDIS_AUTH = process.env.REDIS_AUTH
export const REDIS_DB = process.env.REDIS_DB

const uuidv4 = require('uuid/v4')
export const NODE_ID = uuidv4()