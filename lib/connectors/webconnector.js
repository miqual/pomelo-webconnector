/**
 *  为支持pomelo http https协议 自建连接
 * @type {exports}
 */
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var http = require('http');
var https = require('https');
var express = require('express');
// var pomelo = require('pomelo');
var logger = require('pomelo-logger').getLogger('pomelo');
var bodyParser = require('body-parser');
var jwt = require('jsonwebtoken'); // used to create, sign, and verify tokens
var fs =require('fs');

var ws = require('./websocket');

var curID = 1;
/**
 * connector 构造
 * @param port
 * @param host
 * @returns {Connector}
 * @constructor
 */
var Connector  = function( port, host , opts ) {
    logger.info('webconnector opts ',opts);

    if( !(this instanceof Connector ) ){
        return new Connector(port, host,opts);
    }
    EventEmitter.call( this );

    this.host = host;
    this.port = port;
    this.opts = opts || {};
    this.expRouters = opts && opts.routers;
    this.handlerFilter = opts && opts.handlerFilter;
    this.timeOut = opts.timeOut || 20000;

    this.express = null;
    this.server = null;
    
    if(opts.jwtPrivateKey && opts.jwtPublicKey) {
        Connector.privateKey = this.privateKey = opts.jwtPrivateKey;
        Connector.publicKey = this.publicKey = opts.jwtPublicKey;
    }
    else {
        Connector.privateKey = this.privateKey = fs.readFileSync(__dirname + '/private.pem');
        Connector.publicKey = this.publicKey = fs.readFileSync(__dirname + '/public.pem');
    }
}

util.inherits(Connector,EventEmitter);
module.exports = Connector;

/**
 * 启动服务 ( pomelo 内置规范接口 )
 * @param cb
 */
Connector.prototype.start = function( cb ) {
    var self = this;
    var exp = express();

    self.express = exp;

    exp.use(allowCrossDomain);
    // use body parser so we can get info from POST and/or URL parameters
    exp.use(bodyParser.urlencoded({ extended: false }));
    exp.use(bodyParser.json());
    exp.use(parseMessageProtocol);
    exp.use(verifyToken.bind(this));

    if(this.expRouters){
        for(var i=0; i<this.expRouters.length; i++){
            exp.use(this.expRouters[i].path,this.expRouters[i].router);
        }
    }

    var congigure = this.opts//pomelo.app.get('connectorConfig');
    if( congigure.useSSL ){
        this.server = https.createServer( congigure.ssl, exp)
    }else{
        this.server = http.createServer(exp);
    }
    this.server.listen(this.port);

    var req_process = function( request, response, next ) {
        if(!request.pomelo){
            next();
            
            return;
        }

        var websocket = new ws( curID++, response ,self.timeOut, request.pomelo);
        self.emit('connection',websocket);
        websocket.emit('message',request);
    }

    var methods = congigure.methods || 'all';
    if( methods === 'all' ){
        exp.all('*',req_process);
    }else if(methods === 'post'){
        exp.post('*',req_process);
    }else if( methods === 'get'){
        exp.get('*',req_process);
    }else{
        throw new Error('Listen method error for:'+methods);
    }
    process.nextTick(cb);
}

/**
 * 停止服务 ( pomelo 内置规范接口 )
 * @param force
 * @param cb
 */
Connector.prototype.stop = function( force, cb ){
    process.nextTick(cb);
}

/**
 * 发送消息编码 ( pomelo 内置规范接口 )
 * @type {encode}
 */
Connector.encode = Connector.prototype.encode = function( reqId, route, msg ) {

    if(reqId) {
        return composeResponse(reqId, route, msg);
    } else {
        return composePush(route, msg);
    }
};

/**
 * 收到消息解码 ( pomelo 内置规范接口 )
 * @type {decode}
 */
Connector.decode = Connector.prototype.decode = function(msg) {
    if(!msg.pomelo){
        return {};
    }

    return {
        id: msg.pomelo.id,
        route: msg.pomelo.route,
        body: {
            query:msg.query,
            body:msg.body,
            accessToken:msg.accessToken
        }
    };
};

/**
 * jwt sign
 * @type {decode}
 */
Connector.jwtGenToken = Connector.prototype.jwtGenToken = function(payload,options) {
    if(!Connector.privateKey){
        return '';
    }

    options = options || {expiresIn: 86400, // expires in 24 hours
            algorithm: 'RS256'};

    options.expiresIn = options.expiresIn || 86400;
    options.algorithm = options.algorithm || 'RS256';

    var token = jwt.sign(payload, Connector.privateKey, options);

    return token;
};

/**
 * jwt verify
 * @type {decode}
 */
Connector.jwtVerifyToken = Connector.prototype.jwtVerifyToken = function(token,cb) {
    if(!Connector.publicKey){
        return '';
    }

    jwt.verify(token, Connector.publicKey, function(err, decoded) {
        if (err) {
            cb(err.name,{});
        } else {
           cb(null,decoded);
        }
    });
};

/**
 * 发送消息 ( pomelo 内置规范接口 )
 * @param msg
 */
Connector.prototype.send = function(msg) {
    this.msg = msg;
};

var composeResponse = function( msgId, route, msgBody ) {
    return {
        id: msgId,
        body: msgBody
    };
};

var composePush = function( route, msgBody ) {
    return JSON.stringify({route: route, body: msgBody});
};

var allowCrossDomain = function (req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');//自定义中间件，设置跨域需要的响应头。
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Access-Token,X-Request-Id');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT,DELETE,OPTIONS');

    if(req.method=="OPTIONS") {
        res.status(200).end();
    }
    else{
        next();
    }
};

var parseMessageProtocol = function (req,res,next) {
    var route = req.path.slice(1);
    var ts = route.split('.');
    if(ts.length !== 3) {
        // logger.error('route invalid ',route);
        // res.status(403).send({
		// 	success: false,
		// 	error: 'route invalid'
		// });
        next();
        return;
    }
    
    var msgId = req.query['Request-Id'] || req.body['Request-Id'] || req.get('X-Request-Id') || req.params['Request-Id'] || 0;

    req.pomelo = {
        id : msgId,
        route : route
    }
    next();
    logger.debug('Protocol parse ',JSON.stringify(req.pomelo));
}

var verifyToken = function(req, res, next) {

    if(!req.pomelo){
        next();
        return;
    }
	// check header or url parameters or post parameters for token
	var token = req.query.token || req.body.token || req.headers['x-access-token'] || req.params.token;

	// decode token
	if (token) {
        // verifies secret and checks exp
        this.jwtVerifyToken(token,function(err,decoded){
            if(err) {
                return res.status(403).send({
                    success: false, 
                    error: err
                });
            }
            else {
                req.accessToken = decoded;
                next();
            }
        });

	} else {

        if(this.handlerFilter && this.handlerFilter(req.pomelo.route)) {
            req.accessToken = null;
            next();
        }
        else{
            return res.status(403).send({ 
                success: false, 
                error: 'No token provided.'
            });	
        }	
	}
	
}





//////////////////////////////////////////////////
/**
* http 协议体解析
* @param request
* @param response
* @param next
*/
var bodyParserProtocol = function( request, response, next ) {
    var timeout = setTimeout( function(){
        next(new Error('request time out'));
    },1000);

    //Content-Type
    var bodyChunks = [];
    request.addListener('data',function( chunk ){
        bodyChunks.push(chunk);
    });
    request.addListener('end',function(){
        clearTimeout(timeout);
        try{
            var u = url.parse(request.url,true);
            var query = u.query;
            var id = query['Request-Id'] || 0;

            var body = Buffer.concat(bodyChunks).toString();
            body = body === '' ? '{}':body;
            request.body = {
                id: id,
                route:u.pathname.slice(1,u.pathname.length),
                query:query,
                body:JSON.parse(body)
            };
        }catch( exception ){
            logger.error('request has an exception:'+exception);
            next(new Error('request error'));
            return;
        }
        next(null,request,response);
    });
}