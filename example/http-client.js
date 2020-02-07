
var http = require('http');
var querystring = require('querystring');

var query = 'id=2&passport=abcd';

var body = {
    a:'你好',
    b:'pomelo web 服务'
}

var request = http.request({
    hostname: '127.0.0.1',
    port: 8010,
    // path: '/connector.entryHandler.entry?'+querystring.stringify(query),
    path: '/webconnector.helloWeb.sayHello?'+query,
    method: 'POST',
    headers:{
        'Content-Length':Buffer.byteLength(JSON.stringify(body))
    }
},function( response ){
    response.on('data',function( data ){
        console.log("post response:",data.toString());
    });
});
request.on('error',function( error ){
    console.log('post error:',error);
});
request.write( JSON.stringify(body) );
request.end();


// var requestGet = http.request({
//     hostname: '127.0.0.1',
//     port: 8010,
//     // path: '/connector.entryHandler.entry?'+querystring.stringify(query),
//     path: '/webconnector.helloWeb.sayHello?'+querystring.stringify(query),
//     method: 'GET'
// },function( response ){
//     response.on('data',function( data ){
//         console.log("get response:",data.toString());
//     });
// });
// requestGet.on('error',function( error ){
//     console.log('get error:',error);
// });
// // requestGet.write( JSON.stringify(body) );
// requestGet.end();