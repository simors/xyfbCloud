/**
 * Created by wanpeng on 2017/8/27.
 */
var Promise = require('bluebird')
var amqp = require('amqplib')
var websocketIO = require('../websocketIO')
import {RABBITMQ_URL, NODE_ID} from '../config'
import {execDrawLottery} from '../cloud/fubao'
import {enterWithdrawQueue, createInnerWithdrawRequest} from '../cloud/pay'

export function amqpDrawLotteryEvent() {
  return amqp.connect(RABBITMQ_URL).then((conn) => {
    let chName = 'draw_lottery'
    return conn.createChannel().then(function(ch) {
      //抽奖
      let qName = ''
      ch.assertExchange(chName, 'fanout', {durable: false}).then(() => {
        return ch.assertQueue(qName, {exclusive: true, autoDelete: true})
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
          }).catch((error) => {
            websocketIO[userId].send(JSON.stringify({
              errcode: error.code, money: 0
            }))
            console.log("处理抽奖请求失败", error)
          })
          ch.ack(msg)
        }
      }
    })
  }).catch(console.warn)
}


export function amqpWithdrawEvent() {
  return amqp.connect(RABBITMQ_URL).then((conn) => {
    let chName = 'xyfb_withdraw'
    return conn.createChannel().then(function(ch) {
      //抽奖
      ch.assertExchange(chName, 'fanout', {durable: false}).then(() => {
        return ch.assertQueue('', {exclusive: true})
      }).then((qok) => {
        return ch.bindQueue(qok.queue, chName, '').then(function() {
          return qok.queue;
        });
      }).then((queue) => {
        return ch.consume(queue, handleWithdrawMessage, {noAck: false})
      }).then(() => {
        console.log(' [*] Waiting for withdraw message.')
      })
      
      function handleWithdrawMessage(msg) {
        var body = msg.content.toString()
        var message = JSON.parse(body)
        
        let withdrawId = message.withdrawId
        let userId = message.userId
        let openid = message.openid
        let amount = message.amount
        let channel = message.channel
        let dealType = message.dealType
        let nodeId = message.nodeId
        if (nodeId == NODE_ID) {
          console.log('recv withdraw message', message)
          createInnerWithdrawRequest(withdrawId, userId, openid, amount, channel, dealType).then(() => {
            ch.ack(msg)
          }).catch((err) => {
            enterWithdrawQueue(withdrawId, userId, openid, amount, channel)
            console.log("处理提现请求失败", err)
          })
        }
      }
    })
  }).catch(console.warn)
}