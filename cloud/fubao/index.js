/**
 * Created by yangyang on 2018/1/25.
 */
import AV from 'leancloud-storage'
import * as errno from '../errno'
import mathjs from 'mathjs'
import Promise from 'bluebird'
import moment from 'moment'

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