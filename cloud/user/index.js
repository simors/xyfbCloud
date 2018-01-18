/**
 * Created by yangyang on 2018/1/17.
 */
import AV from 'leanengine'
import * as errno from '../errno'

export function constructUser(leanUser) {
  let user = {}
  if (!leanUser) {
    return undefined
  }
  let leanUserAttr = leanUser.attributes
  user.id = leanUser.id
  user.createdAt = leanUser.createdAt
  user.updatedAt = leanUser.updatedAt
  user.nickname = leanUserAttr.nickname
  user.username = leanUserAttr.username
  user.avatar = leanUserAttr.avatar
  user.gender = leanUserAttr.gender
  user.province = leanUserAttr.province
  user.city = leanUserAttr.city
  let weappUnion = leanUserAttr.authData.lc_weapp_union
  user.weappOpenid = weappUnion && weappUnion.openid ? weappUnion.openid : undefined
  return user
}

export async function updateUserInfo(request) {
  let {nickname, gender, avatar, province, city} = request.params
  let currentUser = request.currentUser
  if (!currentUser) {
    throw new AV.Cloud.Error('Permission denied, need to login first', {code: errno.EACCES});
  }
  
  if (nickname) {
    currentUser.set('nickname', nickname)
  }
  if (gender) {
    currentUser.set('gender', gender)
  }
  if (avatar) {
    currentUser.set('avatar', avatar)
  }
  if (province) {
    currentUser.set('province', province)
  }
  if (city) {
    currentUser.set('city', city)
  }
  await currentUser.save()
  let newUser = await currentUser.fetch()
  return constructUser(newUser)
}

/**
 * 根据用户id获取用户详情
 * @param userId
 */
export async function getUserInfoById(userId) {
  let query = new AV.Query('_User')
  let userInfo = await query.get(userId)
  return constructUser(userInfo)
}

/**
 * 更加用户id获取用户信息的外部接口
 * @param request
 */
export async function reqUserInfo(request) {
  let {userId} = request.params
  return getUserInfoById(userId)
}

/**
 * 根据用户的unionid获取用户信息
 * @param authData
 */
export async function getUserByUnionid(authData) {
  let query = new AV.Query('_User')
  query.equalTo('unionid', authData.unionid)
  let user = await query.first()
  return constructUser(user)
}

/**
 * 根据用户小程序的openid获取用户信息
 * @param authData
 */
export async function getUserByWeappOpenid(authData) {
  let query = new AV.Query('_User')
  if (authData.uid) {
    query.equalTo('authData.lc_weapp_union.openid', authData.openid)
  } else {
    query.equalTo('authData.lc_weapp.openid', authData.openid)
  }
  let user = await query.first()
  return constructUser(user)
}

export async function createUserByWeappAuthData(authData) {
  let leanUser = new AV.User()
  if (authData.uid) {
    leanUser.set('username', authData.uid)
    leanUser.set('unionid', authData.uid)
    return await leanUser.associateWithAuthData(authData, 'lc_weapp_union')
  } else {
    leanUser.set('username', authData.openid)
    return await leanUser.associateWithAuthData(authData, 'lc_weapp')
  }
}

export async function associateUserWithWeappAuthData(userId, authData) {
  let user = AV.Object.createWithoutData('_User', userId)
  if (authData.uid) {
    return await user.associateWithAuthData(authData, 'lc_weapp_union')
  } else {
    return await user.associateWithAuthData(authData, 'lc_weapp')
  }
}