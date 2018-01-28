/**
 * Created by wanpeng on 2017/8/27.
 */
var Promise = require('bluebird')
var amqp = require('amqplib')
var websocketIO = require('../websocketIO')
import {RABBITMQ_URL, NODE_ID} from '../config'
import {DRAW_LOTTERY_RESPONSE} from '../websocket'
import {execDrawLottery} from '../cloud/fubao'

var namespace = websocketIO.of('/')

amqp.connect(RABBITMQ_URL).then(amConnectEvent).catch(console.warn)


function amConnectEvent(conn) {
  return conn.createChannel().then(function(ch) {
    //抽奖
    ch.assertExchange('draw_lottery', 'fanout', {durable: false}).then(() => {
      return ch.assertQueue('', {exclusive: true})
    }).then((qok) => {
      return ch.bindQueue(qok.queue, 'draw_lottery', '').then(function() {
        return qok.queue;
      });
    }).then((queue) => {
      return ch.consume(queue, handleQueueMessage, {noAck: false})
    }).then(() => {
      console.log(' [*] Waiting for lotteryMessage.')
    })

    function handleQueueMessage(msg) {
      var body = msg.content.toString()
      var message = JSON.parse(body)

      console.log("queueMessage:", message)
      let socketId = message.socketId
      let userId = message.userId
      let luckyDipId = message.luckyDipId
      let nodeId = message.nodeId
      namespace.clients((error, client) => {
        if(client.indexOf(socketId) === -1 || nodeId != NODE_ID) {
          //doNothing 多节点情况下
        } else {
          execDrawLottery(userId, luckyDipId).then((result) => {
            namespace.to(socketId).emit(DRAW_LOTTERY_RESPONSE, {errcode: 0, money: result.money})
            ch.ack(msg)
          }).catch((error) => {
            namespace.to(socketId).emit(DRAW_LOTTERY_RESPONSE, {errcode: error.code})
            console.log("处理活动请求失败", error)
          })
        }
      })
    }
  })
}
