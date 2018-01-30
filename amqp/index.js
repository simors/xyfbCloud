/**
 * Created by wanpeng on 2017/8/27.
 */
var Promise = require('bluebird')
var amqp = require('amqplib')
var websocketIO = require('../websocketIO')
import {RABBITMQ_URL, NODE_ID} from '../config'
import {execDrawLottery} from '../cloud/fubao'

export function amqpDrawLotteryEvent(luckyDipId) {
  return amqp.connect(RABBITMQ_URL).then((conn) => {
    let chName = 'draw_lottery' + luckyDipId
    return conn.createChannel().then(function(ch) {
      //抽奖
      ch.assertExchange(chName, 'fanout', {durable: false}).then(() => {
        return ch.assertQueue('', {exclusive: true})
      }).then((qok) => {
        return ch.bindQueue(qok.queue, chName, '').then(function() {
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
        
        let userId = message.userId
        let luckyDipId = message.luckyDipId
        let nodeId = message.nodeId
        if (websocketIO[userId] && nodeId == NODE_ID) {
          execDrawLottery(userId, luckyDipId).then((result) => {
            websocketIO[userId].send(JSON.stringify({
              errcode: 0, money: result.money
            }))
            ch.ack(msg)
          }).catch((error) => {
            websocketIO[userId].send(JSON.stringify({
              errcode: error.code, money: 0
            }))
            console.log("处理活动请求失败", error)
          })
        }
      }
    })
  }).catch(console.warn)
}
