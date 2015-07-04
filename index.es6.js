var request = require('request');
var async   = require('async') ;
var events  = require('events');
var util    = require('util');
var jwt     = require("jsonwebtoken");

// var google = require('googleapis');
// var OAuth2 = google.auth.OAuth2;

class Report extends events.EventEmitter {

    constructor(private_key, service_email, numberMinutes, debug) {
        super();
        this.private_key = private_key;
    	this.service_email = service_email;
        this.numberMinutes = numberMinutes || 59; 		// until expires, must be < 60
        this.debug = debug || false;
        this.scope = 'https://www.googleapis.com/auth/analytics.readonly';
        this.api_url = 'https://www.googleapis.com/analytics/v3/data/ga';

    	events.EventEmitter.call(this);

    	this.getToken( err => {
    		if (err) {
                return this.emit('auth_error', err);
            }

    		return this.emit('ready');
    	});
    }

    getToken(cb) {
    	var d = new Date();
    	var iat = d.getTime() / 1000;			    // iat; seconds, not milliseconds
    	var exp = iat + 60 * this.numberMinutes;	// exp = iat + extra seconds
        var google_url = 'https://www.googleapis.com/oauth2/v3/token';

    	var claim_set = {
    		'iss'  : this.service_email,
    		'scope': this.scope,
    		'aud'  : google_url,
    		'exp'  : exp,
    		'iat'  : iat
    	};
    	var signature = jwt.sign(claim_set, this.private_key, { algorithm: "RS256" });

    	var post_obj = {
    		grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    		assertion: signature
    	};

    	request.post({
    		url : google_url,
    		form: post_obj
    	}, (err, data) => {
    		if (err) return cb(err, null);

    		var body = JSON.parse(data.body);

            // If no token presnet, then return the error
            if ((typeof body.access_token) == 'undefined') {
                return cb("Auth request error: " + body.error_description);
            }

    		// save the new token
    		this.token = body.access_token;

    		// set expiry time (in milliseconds) based on info in token
    		var now = new Date();
    		this.exp = now.setTime(now.getTime() + body.expires_in * 1000);

    		if (this.debug) {
                console.log(".getToken success, result: ", body);
                var tmp = new Date(this.exp);
                console.log("expiry: ", tmp.toLocaleTimeString());
            }

    		cb(null);
    	});
    }

    get(options, cb) {
    	var google_request_url = this.api_url + '?'+this.json2url(options);

    	// If token expired then get new one before requesting data.
    	// This pattern is an asynchronous if ... then
    	async.series([
    		(cb) => {
    			var now = new Date();
    			if (now < this.exp)
    				cb(null);
    			else {
    				if (this.debug) console.log("ga-service-act.get: renewing expired token");
    				this.getToken(cb);
    			}
    		},
    		(cb) => {
    			var auth_obj = {
    				'auth': { 'bearer': this.token }
    			};
    			request.get(google_request_url, auth_obj, cb);
    		}
    	], function(err, data) {
    			if (err) return cb(err, null);
    			// data[1] contains data from request.get
    			// data[1][0] contains ...
    			var body = JSON.parse(data[1][0].body);
    			// if (this.debug) console.log(".get: ", body);
    			return cb(null, body);
    	});
    }

    getManagement(options, cb) {
    	var auth_obj = {
    		'auth': { 'bearer': this.token }
    	};
    	request.get(
    		'https://www.googleapis.com/analytics/v3/management/accounts',
    		auth_obj,
    		(err, data) => {
    			if (err) return cb(err, null);
    			var body = JSON.parse(data.body);
    			return cb(null, body);
    		}
    	);
    }

    json2url(obj) {
    	var res = [];
    	for (var key in obj) {
    		res.push(key + "=" + obj[key]);
    	}
    	return res.join('&');
    }

}

// util.inherits(Report, events.EventEmitter);

module.exports = Report;
