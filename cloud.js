var AV = require('leanengine');
import * as userCloud from './cloud/user'
import * as weappCloud from './cloud/weapp'
import * as payCloud from './cloud/pay'
import * as fubaoCloud from './cloud/fubao'

/* 用户 */
AV.Cloud.define('userUpdateInfo', userCloud.updateUserInfo);
AV.Cloud.define('userFetchUserInfo', userCloud.reqUserInfo);

/* 微信小程序 */
AV.Cloud.define('weappGetAuthData', weappCloud.getWeappAuthData);

/* 支付 */
AV.Cloud.define('payCreatePaymentRequest', payCloud.createPaymentRequest)
AV.Cloud.define('payCreateWithdrawRequest', payCloud.createWithdrawRequest)
AV.Cloud.define('payHandlePaymentWebhootsEvent', payCloud.handlePaymentWebhootsEvent)
AV.Cloud.define('payHandleWithdrawWebhootsEvent', payCloud.handleWithdrawWebhootsEvent)
AV.Cloud.define('payCreateWithdrawApply', payCloud.createWithdrawApply)
AV.Cloud.define('payFetchUserLastWithdrawApply', payCloud.getUserLastWithdrawApply)
AV.Cloud.define('payFetchWithdrawRecords', payCloud.fetchWithdrawRecords)
AV.Cloud.define('payFuncTest', payCloud.payFuncTest)
AV.Cloud.define('payGetWalletInfo', payCloud.reqWalletInfo)
AV.Cloud.define('payWithWalletBalance', payCloud.payWithWalletBalance)
AV.Cloud.define('payFetchUserDealRecords', payCloud.fetchUserDealRecords)

/* 福包 */
AV.Cloud.define('fubaoCreateLuckyDip', fubaoCloud.reqCreateLuckyDip)
AV.Cloud.define('fubaoGetLastFubao', fubaoCloud.getUserLastLuckyDip)
AV.Cloud.define('fubaoFetchLuckyDipById', fubaoCloud.reqLuckyDipById)
AV.Cloud.define('fubaoFetchSendLuckyDip', fubaoCloud.fetchSendLuckyDip)
AV.Cloud.define('fubaoFetchRecvedFubao', fubaoCloud.fetchRecvedFubao)
AV.Cloud.define('fubaoJudgeEnableDrawLottery', fubaoCloud.judgeEnabelDrawLottery)