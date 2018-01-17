/**
 * Created by yangyang on 2017/12/25.
 */
import AV from 'leancloud-storage'
import * as errno from '../errno'
import {getUserByUnionid, createUserByWeappAuthData, associateUserWithWeappAuthData} from '../user'
let urllib = require('urllib')
let crypto = require('crypto')

async function getWeappAccessToken(appid, secret, code) {
  let url = 'https://api.weixin.qq.com/sns/jscode2session';
  let result = await urllib.request(url, {
    method: 'GET',
    data: {
      appid: appid,
      secret: secret,
      js_code: code,
      grant_type: 'authorization_code'
    }
  })
  return JSON.parse(result.data.toString())
}

function decryptData(appId, session_key, encryptedData, iv) {
  // base64 decode
  let sessionKey = new Buffer(session_key, 'base64')
  encryptedData = new Buffer(encryptedData, 'base64')
  iv = new Buffer(iv, 'base64')
  let decoded = undefined
  
  try {
    // 解密
    let decipher = crypto.createDecipheriv('aes-128-cbc', sessionKey, iv)
    // 设置自动 padding 为 true，删除填充补位
    decipher.setAutoPadding(true)
    decoded = decipher.update(encryptedData, 'binary', 'utf8')
    decoded += decipher.final('utf8')
    
    decoded = JSON.parse(decoded)
    
  } catch (err) {
    throw new Error('Illegal Buffer')
  }
  
  if (decoded.watermark.appid !== appId) {
    throw new Error('Illegal Buffer')
  }
  
  return decoded
}

export async function getWeappAuthData(request) {
  let {appid, secret, code, encryptedData, iv} = request.params
  let authData = await getWeappAccessToken(appid, secret, code)
  authData = {
    openid: authData.openid,
    uid: authData.unionid,
    session_key: authData.session_key
  }
  if (!authData.uid) {
    let data = decryptData(appid, authData.session_key, encryptedData , iv)
    authData.uid = data.unionId
  }
  let user = await getUserByUnionid(authData.uid)
  if (!user) {
    await createUserByWeappAuthData(authData)
  } else {
    await associateUserWithWeappAuthData(user.id, authData)
  }
  return authData
}