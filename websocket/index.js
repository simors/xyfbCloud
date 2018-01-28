import * as errno from '../cloud/errno'
import {requestDrawLottery} from '../cloud/fubao'

//websocket消息
const DRAW_LOTTERY_REQUEST = 'DRAW_LOTTERY_REQUEST'               // 抽奖请求
export const DRAW_LOTTERY_RESPONSE = 'DRAW_LOTTERY_RESPONSE'             // 抽奖结果

export async function socketConnectEvent(socket) {
  //接收到H5页面的活动请求
  socket.on(DRAW_LOTTERY_REQUEST, async function (data) {
    let userId = data.userId
    let luckyDipId = data.luckyDipId

    try {
      await requestDrawLottery(socket.id, userId, luckyDipId)
      // socket.emit(DRAW_LOTTERY_RESPONSE, {errorCode: 0})
    } catch (error) {
      console.error(error)
      socket.emit(DRAW_LOTTERY_RESPONSE, {errorCode: error.code})
    }
  })
}