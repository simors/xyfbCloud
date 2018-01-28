/**
 * Created by wanpeng on 2017/8/7.
 */
var server = require('./app')
var websocketIO = require('socket.io')(server)


module.exports = websocketIO