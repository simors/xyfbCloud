var AV = require('leanengine');
import * as userCloud from './cloud/user'
import * as weappCloud from './cloud/weapp'

/* 用户 */
AV.Cloud.define('userUpdateInfo', userCloud.updateUserInfo);
AV.Cloud.define('userFetchUserInfo', userCloud.reqUserInfo);

/* 微信小程序 */
AV.Cloud.define('weappGetAuthData', weappCloud.getWeappAuthData);