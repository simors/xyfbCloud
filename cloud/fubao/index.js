/**
 * Created by yangyang on 2018/1/25.
 */
import AV from 'leancloud-storage'
import * as errno from '../errno'
import mathjs from 'mathjs'
import moment from 'moment'

function constructFubao(leanFubao) {
  if (!leanFubao) {
    return undefined
  }
  let fubao = {}
  let fubaoAttr = leanFubao.attributes
  fubao.id = leanFubao.id
  fubao.createdAt = moment(new Date(leanFubao.createdAt)).format('YYYY-MM-DD HH:mm:ss')
  fubao.updatedAt = moment(new Date(leanFubao.updatedAt)).format('YYYY-MM-DD HH:mm:ss')
  fubao.amount = fubaoAttr.amount
  fubao.count = fubaoAttr.count
  fubao.remark = fubaoAttr.remark
  fubao.balance = fubaoAttr.balance
  fubao.remain = fubaoAttr.remain
  fubao.userId = fubaoAttr.user ? fubaoAttr.user.id : undefined
  return fubao
}

/**
 * 创建一个福包
 * @param userId
 * @param amount
 * @param count
 * @param remark
 * @returns {*}
 */
export async function createFubao(userId, amount, count, remark) {
  let Fubao = AV.Object.extend('Fubao')
  let fubao = new Fubao()
  
  let user = AV.Object.createWithoutData('_User', userId)
  fubao.set('user', user)
  fubao.set('amount', amount)
  fubao.set('count', count)
  fubao.set('remark', remark)
  fubao.set('balance', amount)
  fubao.set('remain', count)
  
  return await fubao.save()
}

/**
 * 获取某用户最新发布的福包
 * @param request
 */
export async function getUserLastFubao(request) {
  let currentUser = request.currentUser
  if (!currentUser) {
    throw new AV.Cloud.Error('Permission denied, need to login first', {code: errno.EACCES});
  }
  
  let query = new AV.Query('Fubao')
  query.equalTo('user', currentUser)
  query.descending('createdAt')
  let fubao = await query.first()
  return constructFubao(fubao)
}