/**
 * Created by yangyang on 2017/3/31.
 */
var mysql = require('mysql')
var Promise = require('bluebird')
import {MYSQL_HOST, MYSQL_USER, MYSQL_PWD, MYSQL_DB} from '../config'

var mysqlPool  = mysql.createPool({
  connectionLimit : 100,
  host            : MYSQL_HOST,
  user            : MYSQL_USER,
  password        : MYSQL_PWD,
  database        : MYSQL_DB,
})

mysqlPool.on('connection', function (connection) {
  // console.log('A new connection %d created.', connection.threadId)
})

mysqlPool.on('release', function (connection) {
  // console.log('Connection %d released.', connection.threadId)
})

function getConnection() {
  return new Promise((resolve, reject) => {
    mysqlPool.getConnection((err, conn) => {
      if (err) {
        reject(err)
      }
      resolve(conn)
    })
  })
}

function release(conn) {
  conn.release()
}

function query(conn, sql, values) {
  return new Promise((resolve, reject) => {
    conn.query(sql, values, (err, results, fields) => {
      if (err) {
        reject(err)
      }
      resolve({results, fields, conn})
    })
  })
}

function beginTransaction(conn) {
  return new Promise((resolve, reject) => {
    conn.beginTransaction((err) => {
      if (err) {
        reject(err)
      }
      resolve(conn)
    })
  })
}

function rollback(conn) {
  return new Promise((resolve, reject) => {
    conn.rollback(() => {
      resolve(conn)
    })
  })
}

function commit(conn) {
  return new Promise((resolve, reject) => {
    conn.commit((err) => {
      if (err) {
        reject(err)
      }
      resolve(conn)
    })
  })
}

var mysqlUtil = {
  getConnection: getConnection,
  release: release,
  query: query,
  beginTransaction: beginTransaction,
  rollback: rollback,
  commit: commit,
}

module.exports = mysqlUtil