/**
 * Created by yangyang on 2018/1/25.
 */
import AV from 'leancloud-storage'
import * as errno from '../errno'
import moment from 'moment'

const HIT_FACTOR = 3       // 中奖因子，如设置为5，则表示中奖概率为1/5

function constructLuckyDip(leanLuckyDip) {
  if (!leanLuckyDip) {
    return undefined
  }
  let luckyDip = {}
  let luckyDipAttr = leanLuckyDip.attributes
  luckyDip.id = leanLuckyDip.id
  luckyDip.createdAt = moment(new Date(leanLuckyDip.createdAt)).format('YYYY-MM-DD HH:mm:ss')
  luckyDip.updatedAt = moment(new Date(leanLuckyDip.updatedAt)).format('YYYY-MM-DD HH:mm:ss')
  luckyDip.amount = luckyDipAttr.amount
  luckyDip.count = luckyDipAttr.count
  luckyDip.remark = luckyDipAttr.remark
  luckyDip.balance = luckyDipAttr.balance
  luckyDip.remain = luckyDipAttr.remain
  luckyDip.userId = luckyDipAttr.user ? luckyDipAttr.user.id : undefined
  return luckyDip
}

/**
 * 创建一个福包抽奖箱
 * @param userId
 * @param amount
 * @param count
 * @param remark
 * @returns {*}
 */
export async function createLuckyDip(userId, amount, count, remark) {
  let LuckyDip = AV.Object.extend('LuckyDip')
  let luckyDip = new LuckyDip()
  
  let user = AV.Object.createWithoutData('_User', userId)
  luckyDip.set('user', user)
  luckyDip.set('amount', amount)
  luckyDip.set('count', count)
  luckyDip.set('remark', remark)
  luckyDip.set('balance', amount)
  luckyDip.set('remain', count)
  
  return await luckyDip.save()
}

/**
 * 获取某用户最新发布的福包
 * @param request
 */
export async function getUserLastLuckyDip(request) {
  let currentUser = request.currentUser
  if (!currentUser) {
    throw new AV.Cloud.Error('Permission denied, need to login first', {code: errno.EACCES});
  }
  
  let query = new AV.Query('LuckyDip')
  query.equalTo('user', currentUser)
  query.descending('createdAt')
  let luckyDip = await query.first()
  return constructLuckyDip(luckyDip)
}

/**
 * 根据id获取抽奖箱信息
 * @param luckyDipId
 * @returns {*|Promise.<AV.Object>}
 */
async function getLuckyDipById(luckyDipId) {
  let query = new AV.Query('LuckyDip')
  let luckyDip = await query.get(luckyDipId)
  luckyDip = constructLuckyDip(luckyDip)
  return luckyDip
}

/**
 * 完成福包摇奖操作
 * @param luckyDipId
 */
async function drawLottery(luckyDipId) {
  let luckyDip = await getLuckyDipById(luckyDipId)
  if (!luckyDip) {
    throw new AV.Cloud.Error('Lucky dip not exist', {code: errno.ERROR_LUCKYDIP_NOT_EXIST});
  }
  if (luckyDip.remain === 0) {
    throw new AV.Cloud.Error('Fubao game over', {code: errno.ERROR_LUCKYDIP_GAME_OVER});
  }
  let hitNum = luckyDip.count     // 需要生成的中奖奖券数量
  let ticketCapacity = (luckyDip.count * HIT_FACTOR)     // 奖池容量
  let tickets = []
  // 洗牌
  let i = 0
  while (true) {
    if (i == hitNum) {
      break
    }
    // 生成1～ticketCapacity之间的随机数作为中奖数字
    let hitTicket = parseInt(Math.random() * ticketCapacity + 1)
    // 防止出现重复的中奖号码
    let hitPos = tickets.findIndex((t) => t == hitTicket)
    if (hitPos >= 0) {
      continue
    }
    tickets.push(hitTicket)
    i++
  }
  // 抽奖
  let myTicket = parseInt(Math.random() * ticketCapacity + 1)
  // 如果抽奖的随机数在奖券池中，则表示抽中奖品
  let pos = tickets.findIndex((t) => t == myTicket)
  if (pos >= 0) {
    let money = getRandomMoney(luckyDip.balance, luckyDip.remain)
    return money
  }
  return 0
}

/**
 * 获得一个随机的金额，额度在0.01和剩余平均值*2之间
 * @param balance
 * @param remain
 * @returns {number}
 */
function getRandomMoney(balance, remain) {
  // 只剩下最后一个福包，获取到剩余的所有金额
  if (remain === 1) {
    return Number(balance).toFixed(2) * 100 / 100
  }
  let min = 0.01
  let max = Number(100 * balance / (100 * remain) * 2).toFixed(2)
  let money = Math.random() * max
  money = money <= min ? min : money
  return Number(money).toFixed(2) * 100 / 100
}

/**
 * 更新抽奖箱余额和剩余奖券数量
 * @param luckyDipId
 * @param money
 * @returns {T}
 */
async function updateLuckyDipBalance(luckyDipId, money) {
  let luckyDip = AV.Object.createWithoutData('LuckyDip', luckyDipId)
  luckyDip.increment('balance', -money)
  luckyDip.increment('remain', -1)
  return await luckyDip.save()
}

/**
 * 执行福包抽奖
 * @param request
 */
export async function execDrawLottery(request) {
  let currentUser = request.currentUser
  if (!currentUser) {
    throw new AV.Cloud.Error('Permission denied, need to login first', {code: errno.EACCES});
  }
  let {luckyDipId} = request.params
  let money = await drawLottery(luckyDipId)
  if (money != 0) {
    await updateLuckyDipBalance(luckyDipId, money)
    return {money}
  }
  return {money: 0}
}