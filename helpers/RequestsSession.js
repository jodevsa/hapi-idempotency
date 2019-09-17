const redis = require('redis');
const debug= require('debug')('Requessts-session-helper');
const { promisify } = require('util');
function serializeObject(object) {
    const array = [];
    Object.keys(object).map(e => {
        array.push(e);
        array.push(object[e]);
    })
    return array;
}
class RequestsSessionHelper {
    constructor({ redisConnectionString, processingTimeOut, timeout }) {
        this.processingTimeOut = processingTimeOut || 25;
        this.timeout = timeout || 1 * 60 * 60 * 24 * 14;
        const redisClient = redis.createClient(redisConnectionString);
        this.redisClient = redisClient;
        this.anotherClient = redis.createClient(redisConnectionString);;
        this.keyPrefix = "request_ride_layer_";
        this.get = promisify(redisClient.get).bind(redisClient);
        this.hgetall = promisify(redisClient.hgetall).bind(redisClient);
        this.set = promisify(redisClient.set).bind(redisClient);
        this.setnx = promisify(redisClient.setnx).bind(redisClient);
        this.hset = promisify(redisClient.hset).bind(redisClient);
        this.del = promisify(redisClient.del).bind(redisClient);
        this.hmset = promisify(redisClient.hmset).bind(redisClient)

    }
    async getOrStartSession(_key, route, method, extraDetails) {
        const key = this.keyPrefix + _key;
        const object = {
            created_at: Date.now(),
            route,
            served: false,
            method,
            data: extraDetails
        };
        const result= await this.set(key, JSON.stringify(object), 'NX', 'EX', this.processingTimeOut);
        if(!result){
            debug(`session with key${_key} is already started`)
        }
        else{
            debug(`started new session with key ${_key}`);
        }
        return result;
    }
    async deleteSession(key) {
        debug(`deleting session with key ${key}`);
        return await this.del(key);
    }
    async markSessionAsComplete(key, responseCode, body) {
        const data = await this.getSesssion(key);
        data.body = body;
        data.statusCode = responseCode;
        data.servedAt = Date.now();
        data.served = true;
        await this.set(this.keyPrefix + key, JSON.stringify(data), 'EX', this.timeout);
        await this.redisClient.publish(key, "OK");
        debug(`request session with ${key} have been marked as completed`);
    }
    waitForSessionToCompleteAndGetInfo(key) {
        return new Promise(async (resolve, reject) => {
            const handler = async (channel, message) => {
                if (channel === key) {
                    this.anotherClient.unsubscribe(key);
                    const ride = await this.getSesssion(key);
                    debug(`active session ${key} have been completed`);
                    this.anotherClient.removeListener('message', handler);
                    return resolve(ride);
                }
            };
            this.anotherClient.on("message", handler);
            this.anotherClient.subscribe(key);
            const ride = await this.getSesssion(key);
            if (ride && ride.served) {
                this.redisClient.unsubscribe(key);
                this.anotherClient.removeListener('message', handler);
                return resolve(ride);
            }
            else{
                debug(`session with key ${key} is still active (waiting for it to finish)`);
            }
        })
    }
    async getSesssion(key) {
        const data = await this.get(this.keyPrefix + key);
        return JSON.parse(data);
    }


}
module.exports = RequestsSessionHelper