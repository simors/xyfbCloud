/**
 * Created by yangyang on 2018/1/25.
 */
import AV from 'leancloud-storage'
import * as errno from '../errno'
import moment from 'moment'
import amqp from 'amqplib'
import {constructUser} from '../user'
import {winMoney, fubaoBalanceEntry} from '../pay'
import {RABBITMQ_URL, NODE_ID} from '../../config'

const HIT_FACTOR = 3       // 中奖因子，如设置为5，则表示中奖概率为1/5
const DEFAULT_PARTICIPANT_NUM = 3     // 默认的抽奖次数

function constructLuckyDip(leanLuckyDip, includeUser) {
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
  luckyDip.isExpire = luckyDipAttr.isExpire
  
  if (includeUser) {
    luckyDip.user = constructUser(luckyDipAttr.user)
  }
  return luckyDip
}

function constructFubao(leanFubao, includeUser, includeLuckyDip) {
  if (!leanFubao) {
    return undefined
  }
  let fubao = {}
  let fubaoAttr = leanFubao.attributes
  fubao.id = leanFubao.id
  fubao.createdAt = moment(new Date(leanFubao.createdAt)).format('YYYY-MM-DD HH:mm:ss')
  fubao.updatedAt = moment(new Date(leanFubao.updatedAt)).format('YYYY-MM-DD HH:mm:ss')
  fubao.money = fubaoAttr.money
  fubao.userId = fubaoAttr.user ? fubaoAttr.user.id : undefined
  fubao.luckyDipId = fubaoAttr.luckyDip ? fubaoAttr.luckyDip.id : undefined
  
  if (includeUser) {
    fubao.user = constructUser(fubaoAttr.user)
  }
  if (includeLuckyDip) {
    fubao.luckyDip = constructLuckyDip(fubaoAttr.luckyDip, false)
  }
  return fubao
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
  
  let leanLuckyDip = await luckyDip.save()
  return constructLuckyDip(leanLuckyDip, false)
}

/**
 * 创建一个福包抽奖箱的网络请求
 * @param request
 * @returns {*}
 */
export async function reqCreateLuckyDip(request) {
  let currentUser = request.currentUser
  if (!currentUser) {
    throw new AV.Cloud.Error('Permission denied, need to login first', {code: errno.EACCES});
  }
  
  let {amount, count, remark} = request.params
  return await createLuckyDip(currentUser.id, amount, count, remark)
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
  return constructLuckyDip(luckyDip, false)
}

/**
 * 获取到用户发送的福包抽奖箱
 * @param request
 * @returns {Array}
 */
export async function fetchSendLuckyDip(request) {
  let currentUser = request.currentUser
  if (!currentUser) {
    throw new AV.Cloud.Error('Permission denied, need to login first', {code: errno.EACCES});
  }
  
  let {lastTime, limit} = request.params
  let query = new AV.Query('LuckyDip')
  query.equalTo('user', currentUser)
  query.descending('createdAt')
  if (limit) {
    query.limit(limit)
  } else {
    query.limit(10)
  }
  if (lastTime) {
    query.lessThan('createdAt', new Date(lastTime))
  }
  
  let result = await query.find()
  let luckyDips = []
  result.forEach((luckyDip) => {
    luckyDips.push(constructLuckyDip(luckyDip, false))
  })
  return luckyDips
}

/**
 * 根据id获取抽奖箱信息
 * @param luckyDipId
 * @returns {*|Promise.<AV.Object>}
 */
async function getLuckyDipById(luckyDipId, includeUser) {
  let query = new AV.Query('LuckyDip')
  if (includeUser) {
    query.include('user')
  }
  let luckyDip = await query.get(luckyDipId)
  luckyDip = constructLuckyDip(luckyDip, includeUser)
  return luckyDip
}

/**
 * 根据id获取抽奖箱的网络请求方法
 * @param request
 * @returns {*|Promise.<AV.Object>}
 */
export async function reqLuckyDipById(request) {
  let {luckyDipId} = request.params
  return await getLuckyDipById(luckyDipId, true)
}

/**
 * 完成福包摇奖操作
 * @param luckyDipId
 */
async function drawLottery(luckyDipId) {
  let luckyDip = await getLuckyDipById(luckyDipId, false)
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
  let luckyDipObj = await getLuckyDipById(luckyDipId, false)
  luckyDip.set('balance', Number(luckyDipObj.balance - money).toFixed(2))
  luckyDip.increment('remain', -1)
  return await luckyDip.save()
}

/**
 * 判断是否可以进行抽奖
 * @param request
 * @returns {boolean}
 */
export async function judgeEnabelDrawLottery(request) {
  let currentUser = request.currentUser
  if (!currentUser) {
    throw new AV.Cloud.Error('Permission denied, need to login first', {code: errno.EACCES});
  }
  let {luckyDipId} = request.params
  let luckyDip = await getLuckyDipById(luckyDipId, false)
  if (luckyDip.isExpire) {
    throw new AV.Cloud.Error('The lucky dip is expire', {code: errno.ERROR_LUCKYDIP_EXPIRE});
  }
  if (luckyDip.remain === 0) {
    throw new AV.Cloud.Error('Fubao game over', {code: errno.ERROR_LUCKYDIP_GAME_OVER});
  }
  let luckyDipUser = await getLuckyDipUser(currentUser.id, luckyDipId)
  if (luckyDipUser && luckyDipUser.attributes.participateNum >= luckyDipUser.attributes.maxParticipateNum) {
    throw new AV.Cloud.Error('The number of participant over', {code: errno.ERROR_LUCKYDIP_PARTICIPANT_OVER});
  }
  return true
}

/**
 * 发起抽奖请求
 * @param userId
 * @param luckyDipId
 */
export async function requestDrawLottery(userId, luckyDipId) {
  let luckyDip = await getLuckyDipById(luckyDipId, false)
  if (luckyDip.isExpire) {
    throw new AV.Cloud.Error('The lucky dip is expire', {code: errno.ERROR_LUCKYDIP_EXPIRE});
  }
  let luckyDipUser = await getLuckyDipUser(userId, luckyDipId)
  if (!luckyDipUser) {
    await insertLuckyDipUser(userId, luckyDipId)
  } else {
    if (luckyDipUser.attributes.participateNum >= luckyDipUser.attributes.maxParticipateNum) {
      throw new AV.Cloud.Error('The number of participant over', {code: errno.ERROR_LUCKYDIP_PARTICIPANT_OVER});
    }
  }
  
  let ex = 'draw_lottery' + luckyDipId
  let message = {
    userId: userId,
    luckyDipId: luckyDipId,
    nodeId: NODE_ID,
  }
  return amqp.connect(RABBITMQ_URL).then(function(conn) {
    return conn.createChannel().then(function(ch) {
      var ok = ch.assertExchange(ex, 'fanout', {durable: false})
      
      return ok.then(function() {
        ch.publish(ex, '', Buffer.from(JSON.stringify(message)));
        return ch.close();
      });
    }).finally(function() { conn.close(); });
  }).catch((error) => {
    throw error
  })
}

/**
 * 执行抽奖
 * @param userId
 * @param luckyDipId
 * @returns {*}
 */
export async function execDrawLottery(userId, luckyDipId) {
  let luckyDipUser = await getLuckyDipUser(userId, luckyDipId)
  if (luckyDipUser) {
    await incLuckyDipParticipantNum(luckyDipUser)
  }
  let money = await drawLottery(luckyDipId)
  if (money != 0) {
    await updateLuckyDipBalance(luckyDipId, money)
    await addNewFubao(userId, luckyDipId, money)
    await winMoney(userId, money)
    return {money}
  }
  return {money: 0}
}

/**
 * 添加一条领取福包的记录
 * @param userId
 * @param luckyDipId
 * @param money
 * @returns {*}
 */
async function addNewFubao(userId, luckyDipId, money) {
  let Fubao = AV.Object.extend('Fubao')
  let fubao = new Fubao()
  
  let user = AV.Object.createWithoutData('_User', userId)
  let luckyDip = AV.Object.createWithoutData('LuckyDip', luckyDipId)
  fubao.set('user', user)
  fubao.set('money', money)
  fubao.set('luckyDip', luckyDip)
  return await fubao.save()
}

/**
 * 获取到用户收到的福包记录
 * @param request
 * @returns {Array}
 */
export async function fetchRecvedFubao(request) {
  let currentUser = request.currentUser
  if (!currentUser) {
    throw new AV.Cloud.Error('Permission denied, need to login first', {code: errno.EACCES});
  }
  
  let {lastTime, limit} = request.params
  let query = new AV.Query('Fubao')
  query.equalTo('user', currentUser)
  query.descending('createdAt')
  if (limit) {
    query.limit(limit)
  } else {
    query.limit(10)
  }
  if (lastTime) {
    query.lessThan('createdAt', new Date(lastTime))
  }
  query.include(['user', 'luckyDip'])
  
  let result = await query.find()
  let fubaos = []
  result.forEach((fubao) => {
    fubaos.push(constructFubao(fubao, true, true))
  })
  return fubaos
}

/**
 * 根据抽奖箱id获取某个抽奖活动所有的参与者
 * @param request
 * @returns {Array}
 */
export async function fetchFubaoJoinUsers(request) {
  let {luckyDipId} = request.params
  
  let query = new AV.Query('Fubao')
  let luckyDip = AV.Object.createWithoutData('LuckyDip', luckyDipId)
  query.equalTo('luckyDip', luckyDip)
  query.include('user')
  query.limit(100)
  
  let result = await query.find()
  let joinUsers = []
  result.forEach((fubao) => {
    joinUsers.push(constructFubao(fubao, true, false))
  })
  return joinUsers
}

/**
 * 根据用户id和抽奖箱id获取对应的用户参与抽奖信息
 * @param userId
 * @param luckyDipId
 * @returns {*|Promise}
 */
async function getLuckyDipUser(userId, luckyDipId) {
  let query = new AV.Query('LuckyDipUser')
  let user = AV.Object.createWithoutData('_User', userId)
  let luckyDip = AV.Object.createWithoutData('LuckyDip', luckyDipId)
  query.equalTo('user', user)
  query.equalTo('luckyDip', luckyDip)
  return await query.first()
}

/**
 * 插入一条新的参与记录
 * @param userId
 * @param luckyDipId
 * @returns {*}
 */
async function insertLuckyDipUser(userId, luckyDipId) {
  let LuckyDipUser = AV.Object.extend('LuckyDipUser')
  let luckyDipUser = new LuckyDipUser()
  
  let user = AV.Object.createWithoutData('_User', userId)
  let luckyDip = AV.Object.createWithoutData('LuckyDip', luckyDipId)
  luckyDipUser.set('user', user)
  luckyDipUser.set('luckyDip', luckyDip)
  luckyDipUser.set('participateNum', 0)
  luckyDipUser.set('maxParticipateNum', DEFAULT_PARTICIPANT_NUM)
  return await luckyDipUser.save()
}

/**
 * 增加用户参与抽奖次数
 * @param luckyDipUser
 * @returns {*}
 */
async function incLuckyDipParticipantNum(luckyDipUser) {
  luckyDipUser.increment('participateNum')
  return await luckyDipUser.save()
}

/**
 * 福包结算
 * @param requeset
 */
export async function fubaoBalanceAccount(request) {
  console.log('begin to run fubao balance account timer')
  let lastTime = undefined
  let result = undefined
  while (true) {
    result = await getUnexpireLuckyDip(lastTime)
    let luckyDips = result.luckyDips
    lastTime = result.lastTime
    if (luckyDips.length == 0) {
      break
    }
    luckyDips.forEach((luckyDip) => {
      let nowDate = moment().format('YYYY-MM-DD HH:mm:ss')
      let createDate = luckyDip.createdAt
      let expireDate = moment(createDate, 'YYYY-MM-DD HH:mm:ss').add(24, 'hours').format('YYYY-MM-DD HH:mm:ss')
      if (nowDate >= expireDate) {
        setLuckyDipExpire(luckyDip.id)
      }
      if (Number(luckyDip.balance).toFixed(2) > 0) {
        fubaoBalanceEntry(luckyDip.userId, Number(luckyDip.balance).toFixed(2))
      }
    })
  }
}

async function getUnexpireLuckyDip(lastTime) {
  let query = new AV.Query('LuckyDip')
  query.equalTo('isExpire', 0)
  query.descending('createdAt')
  if (lastTime) {
    query.lessThan('createdAt', new Date(lastTime))
  }
  query.limit(1000)
  let luckyDips = []
  let result = await query.find()
  result.forEach((ld) => {
    luckyDips.push(constructLuckyDip(ld, false))
  })
  let size = luckyDips.length
  let newLastTime = undefined
  if (size > 0) {
    newLastTime = luckyDips[size-1].createdAt
  }
  return {
    luckyDips,
    lastTime: newLastTime
  }
}

async function setLuckyDipExpire(luckyDipId) {
  let luckyDip = AV.Object.createWithoutData('LuckyDip', luckyDipId)
  luckyDip.set('isExpire', 1)
  return await luckyDip.save()
}