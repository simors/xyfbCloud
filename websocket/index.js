import * as errno from '../cloud/errno'
import {requestDrawLottery} from '../cloud/fubao'
import {amqpDrawLotteryEvent} from '../amqp'

//websocket消息

export async function socketDrawLotteryEvent(ws, userId, luckyDipId) {
  try {
    // await amqpDrawLotteryEvent(luckyDipId)
    await requestDrawLottery(userId, luckyDipId)
  } catch (error) {
    console.error(error)
    ws.send(JSON.stringify({errcode: error.code}))
  }
}