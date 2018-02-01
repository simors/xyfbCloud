/**
 * Created by wanpeng on 2017/11/30.
 */
import AV from 'leancloud-storage'
import * as errno from '../errno'
import mathjs from 'mathjs'
import Pingpp from 'pingpp'
import uuidv4 from 'uuid'
import Promise from 'bluebird'
import moment from 'moment'
import mysqlUtil from '../mysqlUtil'
import {getUserInfoById} from '../user'
import {PINGPP_APP_ID, PINGPP_API_KEY} from '../../config'
import {createLuckyDip} from '../fubao'
import amqp from 'amqplib'
import {RABBITMQ_URL, NODE_ID} from '../../config'

var pingpp = Pingpp(PINGPP_API_KEY)

const DEAL_TYPE = {
  SEND_FUBAO: 1,    // 发福包
  RECV_FUBAO: 2,    // 抢到福包
  WITHDRAW: 3,      // 提现
  FUBAO_BALANCE: 4, // 未领取的福包余额入账
}

// 钱包余额操作类型
const WALLET_OPER = {
  INCREMENT: 1,     // 增加用户余额
  MINUS: 2          // 减少用户余额
}

const WALLET_PROCESS_TYPE = {
  NORMAL_PROCESS: 0,      // 正常状态
  WITHDRAW_PROCESS: 1,    // 正在提现
}

const WITHDRAW_STATUS = {
  APPLYING: 1,      // 提交申请
  DONE: 2,          // 处理完成
}

const WITHDRAW_APPLY_TYPE = {
  WALLET_BALANCE: 1,        // 钱包余额
}

function constructDealRecord(dealRecord) {
  let deal = {}
  deal.id = dealRecord.id
  deal.from = dealRecord.from
  deal.to = dealRecord.to
  deal.cost = dealRecord.cost
  deal.chargeId = dealRecord.charge_id
  deal.orderNo = dealRecord.order_no
  deal.channel = dealRecord.channel
  deal.transactionNo = dealRecord.transaction_no
  deal.dealTime = moment(new Date(dealRecord.deal_time)).format('YYYY-MM-DD HH:mm:ss')
  deal.dealType = dealRecord.deal_type
  deal.fee = dealRecord.fee
  deal.promotionId = dealRecord.promotion_id
  return deal
}

/**
 * 创建ping++支付请求
 * @param request
 * @returns {*}
 */
export async function createPaymentRequest(request) {
  const {currentUser, meta} = request
  if (!currentUser) {
    throw new AV.Cloud.Error('Permission denied, need to login first', {code: errno.EACCES})
  }
  const remoteAddress = meta.remoteAddress
  const {amount, metadata, openid, subject, channel} = request.params

  pingpp.setPrivateKeyPath(__dirname + "/rsa_private_key.pem")
  try {
    const charges = await new Promise((resolve, reject) => {
      const order_no = uuidv4().replace(/-/g, '').substr(0, 16)
      pingpp.charges.create({
        order_no: order_no,
        app: {id: PINGPP_APP_ID},
        channel: channel,
        amount: mathjs.chain(amount).multiply(100).done(),
        client_ip: remoteAddress,
        currency: "cny",
        subject: subject,
        body: "商品的描述信息",
        extra: {
          open_id: openid
        },
        description: "",
        metadata: metadata,
      }, function (err, charge) {
        if (err != null) {
          reject(new AV.Cloud.Error('request charges error' + err.message, {code: errno.ERROR_CREATE_CHARGES}))
        }
        resolve(charge)
      })
    })
    return charges
  } catch (e) {
    throw e
  }
}

/**
 * 创建ping++提现请求
 * @param request
 * @returns {*}
 */
export async function createWithdrawRequest(request) {
  const {currentUser} = request
  if (!currentUser) {
    throw new AV.Cloud.Error('Permission denied, need to login first', {code: errno.EACCES})
  }
  const {amount, metadata, openid, channel} = request.params
  pingpp.setPrivateKeyPath(__dirname + "/rsa_private_key.pem")

  let walletInfo = await getWalletInfo(currentUser.id)
  if(walletInfo.process != WALLET_PROCESS_TYPE.NORMAL_PROCESS) {
    throw new AV.Cloud.Error('提现处理中', {code: errno.ERROR_IN_WITHDRAW_PROCESS})
  }

  let mysqlConn = undefined
  try {
    mysqlConn = await mysqlUtil.getConnection()
    await updateWalletProcess(mysqlConn, metadata.toUser, WALLET_PROCESS_TYPE.WITHDRAW_PROCESS)
    let transfer = await new Promise((resolve, reject) => {
      const order_no = uuidv4().replace(/-/g, '').substr(0, 16)
      pingpp.transfers.create({
        order_no: order_no,
        app: {id: PINGPP_APP_ID},
        channel: channel,
        amount: mathjs.chain(amount).multiply(100).done(),
        currency: "cny",
        type: "b2c",
        recipient: openid,
        extra: {
          // user_name: username,
          // force_check: true,
        },
        description: "测试" ,
        metadata: metadata,
      }, function (err, transfer) {
        if (err != null ) {
          console.error(err)
          updateWalletProcess(mysqlConn, metadata.toUser, WALLET_PROCESS_TYPE.NORMAL_PROCESS)
          reject(new AV.Cloud.Error('request transfer error' + err.message, {code: errno.ERROR_CREATE_TRANSFER}))
        }
        resolve(transfer)
      })
    })
    return transfer
  } catch (e) {
    if(mysqlConn) {
      await mysqlUtil.rollback(mysqlConn)
    }
    throw e
  } finally {
    if(mysqlConn) {
      await mysqlUtil.release(mysqlConn)
    }
  }
}

/**
 * 服务器内服发起的提现请求
 * @param withdrawId
 * @param userId
 * @param openid
 * @param amount
 * @param channel
 * @param dealType
 * @returns {*}
 */
export async function createInnerWithdrawRequest(withdrawId, userId, openid, amount, channel, dealType) {
  pingpp.setPrivateKeyPath(__dirname + "/rsa_private_key.pem")
  
  let walletInfo = await getWalletInfo(userId)
  if(walletInfo.process != WALLET_PROCESS_TYPE.NORMAL_PROCESS) {
    throw new AV.Cloud.Error('提现处理中', {code: errno.ERROR_IN_WITHDRAW_PROCESS})
  }
  
  let mysqlConn = undefined
  try {
    mysqlConn = await mysqlUtil.getConnection()
    await updateWalletProcess(mysqlConn, userId, WALLET_PROCESS_TYPE.WITHDRAW_PROCESS)
    let transfer = await new Promise((resolve, reject) => {
      const order_no = uuidv4().replace(/-/g, '').substr(0, 16)
      pingpp.transfers.create({
        order_no: order_no,
        app: {id: PINGPP_APP_ID},
        channel: channel,
        amount: mathjs.chain(amount).multiply(100).done(),
        currency: "cny",
        type: "b2c",
        recipient: openid,
        extra: {},
        description: "服务器自动发起提现" ,
        metadata: {
          'fromUser': 'platform',
          'toUser': userId,
          'dealType': dealType,
          'operator': '',
          'withdrawId': withdrawId,
        },
      }, function (err, transfer) {
        if (err != null ) {
          console.error(err)
          updateWalletProcess(mysqlConn, userId, WALLET_PROCESS_TYPE.NORMAL_PROCESS)
          reject(new AV.Cloud.Error('request transfer error' + err.message, {code: errno.ERROR_CREATE_TRANSFER}))
        }
        resolve(transfer)
      })
    })
    return transfer
  } catch (e) {
    if(mysqlConn) {
      await mysqlUtil.rollback(mysqlConn)
    }
    throw e
  } finally {
    if(mysqlConn) {
      await mysqlUtil.release(mysqlConn)
    }
  }
}

/**
 * 处理ping++支付成功后的webhooks消息
 * @param request
 */
export async function handlePaymentWebhootsEvent(request) {
  const {data} = request.params
  const charge = data

  const amount = mathjs.chain(charge.amount).multiply(0.01).done()
  const dealType = Number(charge.metadata.dealType)
  const toUser = charge.metadata.toUser
  const fromUser = charge.metadata.fromUser
  var payTime = charge.created  //unix时间戳
  const deal = {
    from: fromUser,
    to: toUser,
    cost: amount,
    deal_type: dealType,
    charge_id: charge.id,
    order_no: charge.order_no,
    channel: charge.channel,
    transaction_no: charge.transaction_no,
    openid: charge.extra.open_id,
    payTime: payTime,
    metadata: charge.metadata,
  }

  let mysqlConn = undefined
  try {
    mysqlConn = await mysqlUtil.getConnection()
    await mysqlUtil.beginTransaction(mysqlConn)
    await addDealRecord(mysqlConn, deal)
    switch (dealType) {
      case DEAL_TYPE.SEND_FUBAO:
        // 创建抽奖箱的过程放到小程序端完成
        // await createLuckyDip(fromUser, Number(amount), Number(metadata.count), metadata.remark)
        break
      default:
        console.error('unsupported deal type!')
    }
    await mysqlUtil.commit(mysqlConn)
  } catch (error) {
    if(mysqlConn) {
      await mysqlUtil.rollback(mysqlConn)
    }
    let metadata = charge.metadata
    enterWithdrawQueue(metadata.withdrawId, toUser, deal.openid, amount, deal.channel)
    throw error
  } finally {
    if(mysqlConn) {
      await mysqlUtil.release(mysqlConn)
    }
  }
}

/**
 * 处理ping++提现请求成功的webhooks消息
 * @param request
 */
export async function handleWithdrawWebhootsEvent(request) {
  const {data} = request.params
  const transfer = data

  const toUser = transfer.metadata.toUser
  const fromUser = transfer.metadata.fromUser
  const amount = mathjs.chain(transfer.amount).multiply(0.01).done()
  const dealType = transfer.metadata.dealType
  const operator = transfer.metadata.operator
  const withdrawId = transfer.metadata.withdrawId

  var deal = {
    from: fromUser,
    to: toUser,
    cost: amount,
    deal_type: dealType,
    charge_id: transfer.id,
    order_no: transfer.order_no,
    channel: transfer.channel,
    transaction_no: transfer.transaction_no,
    openid: transfer.recipient,
    metadata: transfer.metadata
  }

  let mysqlConn = undefined
  try {
    mysqlConn = await mysqlUtil.getConnection()
    await mysqlUtil.beginTransaction(mysqlConn)
    await addDealRecord(mysqlConn, deal)
    await confirmWithdraw(mysqlConn, operator, withdrawId)
    await updateBalance(mysqlConn, deal.to, deal.cost, WALLET_OPER.MINUS)
    await updateWalletProcess(mysqlConn, toUser, WALLET_PROCESS_TYPE.NORMAL_PROCESS)
    // TODO 增加业务处理逻辑
    await mysqlUtil.commit(mysqlConn)
  } catch (error) {
    if(mysqlConn) {
      await mysqlUtil.rollback(mysqlConn)
    }
    throw error
  } finally {
    if(mysqlConn) {
      await mysqlUtil.release(mysqlConn)
    }
  }
}

/**
 * 创建用户钱包记录
 * @param userId
 * @returns {{userId: *, balance: number, openid: string, user_name: string, process: number}}
 */
export async function createUserWallet(userId) {
  if(!userId) {
    throw new AV.Cloud.Error('参数错误', {code: errno.EINVAL})
  }
  let userInfo = await getUserInfoById(userId)
  let mysqlConn = undefined
  try {
    mysqlConn = await mysqlUtil.getConnection()
    let sql = "SELECT * FROM `Wallet` WHERE `userId` = ?"
    let queryRes = await mysqlUtil.query(mysqlConn, sql, [userId])
    if(queryRes.results.length === 0) {
      sql = "INSERT INTO `Wallet` (`userId`, `balance`, `password`, `openid`, `user_name`, `process`) VALUES (?, ?, ?, ?, ?, ?)"
      await mysqlUtil.query(mysqlConn, sql, [userId, 0, '', userInfo.openid || '', '', WALLET_PROCESS_TYPE.NORMAL_PROCESS])
      return {
        userId: userId,
        balance: 0,
        openid: '',
        user_name: '',
        process: WALLET_PROCESS_TYPE.NORMAL_PROCESS,
      }
    } else {
      throw new AV.Cloud.Error('用户钱包信息已存在', {code: errno.EEXIST})
    }
  } catch (error) {
    console.error("createUserWallet", error)
    throw error
  } finally {
    if (mysqlConn) {
      await mysqlUtil.release(mysqlConn)
    }
  }
}

/**
 * 获取用户钱包信息
 * @param userId
 * @returns {*}
 */
export async function getWalletInfo(userId) {
  if(!userId) {
    throw new AV.Cloud.Error('参数错误', {code: errno.EINVAL})
  }
  let mysqlConn = undefined
  let walletInfo = {}

  try {
    mysqlConn = await mysqlUtil.getConnection()
    let sql = "SELECT * FROM `Wallet` WHERE `userId` = ?"
    let queryRes = await mysqlUtil.query(mysqlConn, sql, [userId])
    if(queryRes.results.length === 0) {
      return createUserWallet(userId)
    } else {
      walletInfo.userId = queryRes.results[0].userId || userId
      walletInfo.balance = queryRes.results[0].balance || 0
      walletInfo.openid = queryRes.results[0].openid || ""
      walletInfo.user_name = queryRes.results[0].user_name || ""
      walletInfo.process = queryRes.results[0].process || WALLET_PROCESS_TYPE.NORMAL_PROCESS
      return walletInfo
    }
  } catch (error) {
    console.error("getWalletInfo", error)
    throw error
  } finally {
    if (mysqlConn) {
      await mysqlUtil.release(mysqlConn)
    }
  }
}

/**
 * 获取用户钱包信息的网络请求接口
 * @param request
 * @returns {*}
 */
export async function reqWalletInfo(request) {
  let currentUser = request.currentUser
  if (!currentUser) {
    throw new AV.Cloud.Error('Permission denied, need to login first', {code: errno.EACCES});
  }
  return await getWalletInfo(currentUser.id)
}

/**
 * 更新用户钱包状态
 * @param conn
 * @param {String} userId
 * @param {Number} process
 */
async function updateWalletProcess(conn, userId, process) {
  if(!userId || process === undefined) {
    throw new AV.Cloud.Error('参数错误', {code: errno.EINVAL})
  }

  try {
    let sql = "UPDATE `Wallet` SET `process`= ? WHERE `userId`=?"
    let updateRes = await mysqlUtil.query(conn, sql, [process, userId])
    if (0 == updateRes.results.changedRows) {
      throw new AV.Cloud.Error('更新用户钱包状态错误', {code: errno.EIO})
    }
    return updateRes.results
  } catch (error) {
    throw error
  }
}

/**
 * 更新用户余额
 * @param conn
 * @param userId
 * @param cost
 * @param type    操作的类型，取值为WALLET_OPER
 */
async function updateBalance(conn, userId, cost, type) {
  if (cost === 0) {
    return undefined
  }
  try {
    let sql = ""
    if (type === WALLET_OPER.INCREMENT) {
      sql = "UPDATE `Wallet` SET `balance`= `balance` + ? WHERE `userId`=?"
    } else if (type === WALLET_OPER.MINUS) {
      sql = "UPDATE `Wallet` SET `balance`= `balance` - ? WHERE `userId`=?"
    }
    let updateRes = await mysqlUtil.query(conn, sql, [Number(cost), userId])
    if (0 == updateRes.results.changedRows) {
      throw new AV.Cloud.Error('修改余额出现错误', {code: errno.EIO})
    }
    return updateRes.results
  } catch (e) {
    throw e
  }
}

/**
 * 中奖后，更新用户的钱包信息
 * @param userId
 * @param money
 */
export async function winMoney(userId, money) {
  if(!userId) {
    throw new AV.Cloud.Error('参数错误', {code: errno.EINVAL})
  }
  let mysqlConn = undefined
  let walletInfo = await getWalletInfo(userId)
  
  try {
    mysqlConn = await mysqlUtil.getConnection()
    await mysqlUtil.beginTransaction(mysqlConn)
    await updateBalance(mysqlConn, userId, money, WALLET_OPER.INCREMENT)
    var deal = {
      from: 'platform',
      to: userId,
      cost: money,
      deal_type: DEAL_TYPE.RECV_FUBAO,
      charge_id: '',
      order_no: uuidv4().replace(/-/g, '').substr(0, 16),
      channel: '',
      transaction_no: ''
    }
    await addDealRecord(mysqlConn, deal)
    await mysqlUtil.commit(mysqlConn)
  } catch (error) {
    console.error("winMoney", error)
    if(mysqlConn) {
      await mysqlUtil.rollback(mysqlConn)
    }
    throw error
  } finally {
    if (mysqlConn) {
      await mysqlUtil.release(mysqlConn)
    }
  }
}

/**
 * 未被领取的福包结算
 * @param userId
 * @param balance
 */
export async function fubaoBalanceEntry(userId, balance) {
  if(!userId) {
    throw new AV.Cloud.Error('参数错误', {code: errno.EINVAL})
  }
  let mysqlConn = undefined
  let walletInfo = await getWalletInfo(userId)
  
  try {
    mysqlConn = await mysqlUtil.getConnection()
    await mysqlUtil.beginTransaction(mysqlConn)
    await updateBalance(mysqlConn, userId, balance, WALLET_OPER.INCREMENT)
    var deal = {
      from: 'platform',
      to: userId,
      cost: balance,
      deal_type: DEAL_TYPE.FUBAO_BALANCE,
      charge_id: '',
      order_no: uuidv4().replace(/-/g, '').substr(0, 16),
      channel: '',
      transaction_no: ''
    }
    await addDealRecord(mysqlConn, deal)
    await mysqlUtil.commit(mysqlConn)
  } catch (error) {
    console.error("fubaoBalanceEntry", error)
    if(mysqlConn) {
      await mysqlUtil.rollback(mysqlConn)
    }
    throw error
  } finally {
    if (mysqlConn) {
      await mysqlUtil.release(mysqlConn)
    }
  }
}

/**
 * 增加交易记录
 * @param conn
 * @param deal
 * @returns {*}
 */
async function addDealRecord(conn, deal) {
  if (deal.cost === 0) {
    return undefined
  }
  if (!deal.from || !deal.to || !deal.cost || !deal.deal_type) {
    throw new AV.Cloud.Error('参数错误', {code: errno.EACCES})
  }
  var charge_id = deal.charge_id || ''
  var order_no = deal.order_no || ''
  var channel = deal.channel || ''
  var transaction_no = deal.transaction_no || ''
  var feeAmount = deal.feeAmount || 0
  let promotionId = deal.metadata && deal.metadata.promotionId ? deal.metadata.promotionId : undefined
  var recordSql = 'INSERT INTO `DealRecords` (`from`, `to`, `cost`, `deal_type`, `charge_id`, `order_no`, `channel`, `transaction_no`, `fee`, `promotion_id`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  return mysqlUtil.query(conn, recordSql, [deal.from, deal.to, deal.cost, deal.deal_type, charge_id, order_no, channel, transaction_no, feeAmount, promotionId || ''])
}

/**
 * 为取现生成一条新的数据记录
 * @param request
 * @returns {Function|results|Array}
 */
export async function createWithdrawApply(request) {
  let conn = undefined
  let currentUser = request.currentUser
  if(!currentUser) {
    throw new AV.Cloud.Error('用户未登录', {code: errno.EPERM})
  }
  let {amount, applyType, channel} = request.params
  let userId = currentUser.id
  let openid = undefined
  if (channel === 'wx_lite') {
    openid = currentUser.attributes.authData.lc_weapp_union.openid
  } else if(channel === 'wx_pub') {
    openid = currentUser.attributes.authData.weixin.openid
  }
  if (!openid) {
    throw new AV.Cloud.Error('用户未绑定微信号', {code: errno.ERROR_NO_WECHAT})
  }
  let walletInfo = await getWalletInfo(currentUser.id)
  if(Number(walletInfo.balance) < Number(amount)) {
    throw new AV.Cloud.Error('余额不足', {code: errno.ERROR_NOT_ENOUGH_MONEY})
  }

  try {
    conn = await mysqlUtil.getConnection()

    let result = await isWithdrawApplying(conn, currentUser.id)
    if(result) {
      throw new AV.Cloud.Error('提现处理中', {code: errno.ERROR_IN_WITHDRAW_PROCESS})
    }

    let iSql = 'INSERT INTO `WithdrawApply` (`userId`, `openid`, `amount`, `applyDate`, `status`, `applyType`, `channel`) VALUES(?, ?, ?, ?, ?, ?, ?)'
    let insertRes = await mysqlUtil.query(conn, iSql, [userId, openid, amount, moment().format('YYYY-MM-DD HH:mm:ss'), WITHDRAW_STATUS.APPLYING, applyType, channel])
    if (!insertRes.results.insertId) {
      throw new AV.Cloud.Error('生成取现申请失败', {code: errno.EIO})
    }
    let dealType = undefined
    if (applyType === WITHDRAW_APPLY_TYPE.WALLET_BALANCE) {
      dealType = DEAL_TYPE.WITHDRAW
    }
    enterWithdrawQueue(insertRes.results.insertId, userId, openid, amount, channel, dealType)
    return insertRes.results
  } catch (e) {
    throw e
  } finally {
    if (conn) {
      await mysqlUtil.release(conn)
    }
  }
}

/**
 * 将提现请求加入处理队列
 * @param withdrawId
 * @param userId
 * @param openid
 * @param amount
 * @param channel
 * @param dealType
 * @returns {*}
 */
export async function enterWithdrawQueue(withdrawId, userId, openid, amount, channel, dealType) {
  let ex = 'xyfb_withdraw'
  let message = {
    withdrawId: withdrawId,
    userId: userId,
    openid: openid,
    amount: amount,
    channel: channel,
    dealType: dealType,
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
 * 确认用户可取现后，将数据库的记录更新
 * @param conn          数据库连接
 * @param operator      操作员id
 * @param orderId       订单id
 * @returns {Function|results|Array}
 */
async function confirmWithdraw(conn, operator, orderId) {
  try {
    let sql = 'UPDATE `WithdrawApply` SET `status`=?, `operator`=?, `operateDate`=? WHERE `id`=?'
    let updateRes = await mysqlUtil.query(conn, sql, [WITHDRAW_STATUS.DONE, operator, moment().format('YYYY-MM-DD HH:mm:ss'), orderId])
    if (0 == updateRes.results.changedRows) {
      throw new AV.Cloud.Error('确认取现出现错误', {code: errno.EIO})
    }
    return updateRes.results
  } catch (e) {
    throw e
  }
}

/**
 * 查询用户是否有正在申请的提现记录
 * @param conn          数据库连接
 * @param {String} userId
 */
async function isWithdrawApplying(conn, userId) {
  try {
    let sql = 'SELECT * FROM `WithdrawApply` WHERE status=? AND `userId`=?'
    let queryRes = await mysqlUtil.query(conn, sql, [WITHDRAW_STATUS.APPLYING, userId])
    if(0 === queryRes.results.length) {
      return false
    }
    return true
  } catch (e) {
    throw e
  }
}

export async function getUserLastWithdrawApply(request) {
  let currentUser = request.currentUser
  if (!currentUser) {
    throw new AV.Cloud.Error('Permission denied, need to login first', {code: errno.EACCES});
  }
  let userId = currentUser.id
  let conn = undefined
  try {
    conn = await mysqlUtil.getConnection()
    let sql = 'SELECT * FROM `WithdrawApply` WHERE status=? AND `userId`=?'
    let queryRes = await mysqlUtil.query(conn, sql, [WITHDRAW_STATUS.APPLYING, userId])
    if(0 === queryRes.results.length) {
      return undefined
    }
    return queryRes.results[0]
  } catch (e) {
    throw e
  } finally {
    if (conn) {
      await mysqlUtil.release(conn)
    }
  }
}

/**
 * 获取取现记录列表
 * @param request
 * @returns {*}
 */
export async function fetchWithdrawRecords(request) {
  let conn = undefined
  let {startTime, endTime, applyType, status, limit} = request.params
  try {
    let sqlParams = []
    conn = await mysqlUtil.getConnection()
    let sql = 'SELECT * FROM `WithdrawApply` '
    if (applyType) {
      sql += 'WHERE `applyType`=? '
      sqlParams.push(applyType)
    } else {
      sql += 'WHERE `applyType` IN (?) '
      sqlParams.push(WITHDRAW_APPLY_TYPE.WALLET_BALANCE)
    }
    if (startTime && endTime) {
      sql += 'AND `applyDate`>? AND `applyDate`<? '
      sqlParams.push(startTime, endTime)
    }
    if (status) {
      sql += 'AND `status`=? '
      sqlParams.push(status)
    }
    if (limit) {
      sql += 'ORDER BY `applyDate` DESC LIMIT ?'
      sqlParams.push(limit)
    } else {
      sql += 'ORDER BY `applyDate` DESC LIMIT 100'
    }
    let queryRes = await mysqlUtil.query(conn, sql, sqlParams)
    let result = queryRes.results
    if (result.length == 0) {
      return []
    }
    let withdrawList = []
    for (let apply of result) {
      let userInfo = await getUserInfoById(apply.userId)
      let operatorInfo = undefined
      if (apply.operator) {
        operatorInfo = await getUserInfoById(apply.operator)
      }
      let withdrawInfo = {
        ...apply,
        nickname: userInfo.nickname || undefined,
        mobilePhoneNumber: userInfo.mobilePhoneNumber || undefined,
        operatorName: operatorInfo && operatorInfo.nickname ? operatorInfo.nickname : undefined,
      }
      withdrawList.push(withdrawInfo)
    }

    return withdrawList
  } catch (e) {
    throw e
  } finally {
    if (conn) {
      await mysqlUtil.release(conn)
    }
  }
}


export async function payFuncTest(request) {
  const {currentUser, params} = request
  const {process} = params
  return await updateWalletProcess(currentUser.id, process)
}

/**
 * 使用账户余额完成支付
 * @param request
 */
export async function payWithWalletBalance(request) {
  let currentUser = request.currentUser
  if (!currentUser) {
    throw new AV.Cloud.Error('Permission denied, need to login first', {code: errno.EACCES});
  }
  let {amount, dealType, metadata} = request.params
  let wallet = await getWalletInfo(currentUser.id)
  if (wallet.balance < amount) {
    throw new AV.Cloud.Error('Not enough balance in wallet', {code: errno.ERROR_NOT_ENOUGH_MONEY});
  }
  const deal = {
    from: currentUser.id,
    to: 'platform',
    cost: amount,
    deal_type: dealType,
    charge_id: '',
    order_no: uuidv4().replace(/-/g, '').substr(0, 16),
    channel: '',
    transaction_no: '',
    openid: '',
    payTime: Date.now(),
    metadata: metadata,
  }
  let mysqlConn = undefined
  try {
    mysqlConn = await mysqlUtil.getConnection()
    await mysqlUtil.beginTransaction(mysqlConn)
    await addDealRecord(mysqlConn, deal)
    await updateBalance(mysqlConn, currentUser.id, amount, WALLET_OPER.MINUS)
    switch (dealType) {
      case DEAL_TYPE.VOTE_PAY:
        await updateVoteStatus(metadata.voteId, VOTE_STATUS.WAITING)
        break
      default:
        console.error('Unsupported deal type!')
    }
    await mysqlUtil.commit(mysqlConn)
  } catch (error) {
    if(mysqlConn) {
      await mysqlUtil.rollback(mysqlConn)
    }
    throw new AV.Cloud.Error('pay with balance error', {code: errno.ERROR_PAY_INNER_PROCESS});
  } finally {
    if(mysqlConn) {
      await mysqlUtil.release(mysqlConn)
    }
  }
}

/**
 * 获取用户所有交易记录
 * @param request
 */
export async function fetchUserDealRecords(request) {
  let currentUser = request.currentUser
  if (!currentUser) {
    throw new AV.Cloud.Error('Permission denied, need to login first', {code: errno.EACCES});
  }
  let {lastTime, limit} = request.params
  
  let mysqlConn = undefined
  let userId = currentUser.id
  let fetchLimit = limit || 10
  let sqlParams = [userId, userId]
  try {
    mysqlConn = await mysqlUtil.getConnection()
    let sql = "SELECT * FROM `DealRecords` WHERE (`from` = ? OR `to` = ?) "
    if (lastTime) {
      sql += ' AND deal_time < ? '
      sqlParams.push(lastTime)
    }
    sql += 'ORDER BY `deal_time` DESC LIMIT ?'
    sqlParams.push(fetchLimit)
    let queryRes = await mysqlUtil.query(mysqlConn, sql, sqlParams)
    let deals = []
    queryRes.results.forEach((deal) => {
      deals.push(constructDealRecord(deal))
    })
    return deals
  } catch (error) {
    throw new AV.Cloud.Error('query user deal records error', {code: errno.EIO});
  } finally {
    if(mysqlConn) {
      await mysqlUtil.release(mysqlConn)
    }
  }
}

