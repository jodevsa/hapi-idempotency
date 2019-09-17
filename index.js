const RequestsSessionHelper = require('./helpers/RequestsSession');
const assert = require('assert');



const plugin = {
    name: "Idempotency layer",
    register: async function (server, options, next) {
        const redisURL= options.redisURL;
        assert(redisURL,'redisURL is required for hapi-dempotency-layer to operate!');
        const helper= new RequestsSessionHelper({redisConnectionString:redisURL});
        // run after authentication!
        server.ext('onPreResponse',async function(req,res){
            const headers=req.headers;
            const idempotencykey = headers['idempotency-key'] || headers['Idempotency-Key'];
            if(idempotencykey && !req.__idempotencyResponse){
                const response= req.response;
                const body=response.source;
                const statusCode=response.statusCode;
                if(statusCode >=200 && statusCode<=299){
                    await helper.markSessionAsComplete(idempotencykey,statusCode,body);
                }
                else{
                    await helper.deleteSession(idempotencykey);
                }
                res.continue();
            }
            else{
                res.continue();
            }
            

        });
        server.ext('onPostAuth',async function(req, res){
            const headers=req.headers;
            if(headers['idempotency-key']){
                const key = headers['idempotency-key'];
                const method = req.method;
                const url = req.url.href
                const result= await helper.getOrStartSession(key,url,method);
                if(!result){
                    const data = await helper.waitForSessionToCompleteAndGetInfo(key);
                    req.__idempotencyResponse=true;
                    return res(data.body).code(Number(data.statusCode))
                    // header can be used later for debuging purposes.
                    .header('duplicate-request',true);
                }
                else{
                    res.continue();
                }
            }
            else{
                res.continue();
            }
        });
        next();

    }
};


plugin.register.attributes = {
    name: 'idempotency layer',
    version: '1.0.0',
};

module.exports=plugin;

