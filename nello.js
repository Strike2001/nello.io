'use strict';

const _request = require('axios');
const _qs = require('querystring');
const _fs = require('fs');
const _http = require('http');
const _https = require('https');
const _ical = require('ical.js');

/**
 * Nello
 *
 * @description Javascript implementation of the nello.io API
 * @author Zefau <https://github.com/Zefau/>
 * @license MIT License
 * @version 0.5.4
 *
 */
class Nello
{
	/**
	* Ical Object.
	*
	* @typedef	ical
	* @type		{object}
	* @property	{string}		uid				UID of the event
	* @property	{string}		name			Name of the event
	* @property	{string}		summary			Summary of the event
	* @property	{object}		dtstamp			Stamp of the event with indizes year, month, day, hour, minute, second, isDate, timezone
	* @property	{object}		dtstart			Start of the event with indizes year, month, day, hour, minute, second, isDate, timezone
	* @property	{object}		dtend			End of the event with indizes year, month, day, hour, minute, second, isDate, timezone
	* @property	{object}		recurrence		Recurrence of event with indizes depending on specific recurrency freq, byday, bymonthday, bymonth, until
	*
	*/
	
	
	/**
	 * Constructor.
	 *
	 * @param	{object}		token			(optional) Object containing token
	 * @param	{string}		token.type		Token Type
	 * @param	{string}		token.access	Token Access
	 * @param	{object}		ssl				(optional) Object for SSL connection
	 * @param	{string}		ssl.key			(optional) Private Key for SSL connection
	 * @param	{string}		ssl.cert		(optional) Certificate for SSL connection
	 * @param	{string}		ssl.ca			(optional) Certificate Authority for SSL connection
	 * @param	{string}		ssl.selfSigned	(optional) Indicates whether SSL certificate is self signed (default to true)
	 * @return	void
	 *
	 */
    constructor(token, ssl)
	{
		// assign token
		this.token = token === undefined || token.type === undefined || token.access === undefined ? false : {type: token.type, access: token.access};
		
		// SSL
		this.isSecure = ssl !== undefined && ssl.key !== undefined && ssl.cert !== undefined && ssl.key !== '' && ssl.cert !== '';
		this.ssl = !this.isSecure ? null : {selfSigned: ssl.selfSigned || true, key: ssl.key, ca: ssl.ca || null, cert: ssl.cert};
		
		this.server = null;
    }
	
	/**
	 * Converts an ical string to an object with all the data. See https://www.npmjs.com/package/jsical for more information.
	 *
	 * @see		{@link https://www.npmjs.com/package/jsical|jsical -Javascript parser for rfc5545-} for more information on the returned value
	 * @param	{string}		ical			Ical string to be converted
	 * @return	{ical}							Parsed ical as object (incl. _raw index for original string)		
	 *
	 */
	_getIcal(ical)
	{
		var data = {_raw: JSON.stringify(ical)};
		var vevent = new _ical.Component(_ical.parse(ical)).getFirstSubcomponent('vevent');
		['UID', 'SUMMARY', 'DTSTAMP', 'DTSTART', 'DTEND'].forEach(function(key)
		{
			data[key.toLowerCase()] = vevent.getFirstPropertyValue(key.toLowerCase()) || null;
		});
		
		data.rrule = new _ical.Recur(vevent.getFirstPropertyValue('rrule'));
		return data;
	}
	
	/**
	 * Handle HTTP / HTTPS response.
	 *
	 * @param	{object}		request
	 * @param	{object}		response
	 * @param	{function}		callback		(optional) Callback function to be invoked
	 * @return	void
	 *
	 */
	_handler(callback)
	{
		return function(request, response)
		{
			var body = [];
			request
				.on('error', function(err) {callback({result: false, error: err})})
				.on('data', function(chunk) {body.push(chunk)})
				.on('end', function()
				{
					var result = null;
					try {
						body = JSON.parse(Buffer.concat(body).toString());
						body.data.timestamp = Math.round(Date.now()/1000);
						result = {result: true, body: body};
					}
					catch(err) {
						result = {result: false, error: err.message};
					}
					
					callback(result);
				});
		}
	}
	
	/**
	 * Try to parse string to a date-time usable for ical.
	 *
	 * @param	{string}			str			Date-Time string to be parsed
	 * @return	{string}						Converted ical usable datetime string, format YYYYMMDDTHHMMSSZ
	 *
	 */
	_getDateTime(str)
	{
		str = str.toString();
		var date = null;
		
		// check if format is correct already
		if (str.charAt(8) === 'T' && str.charAt(15) === 'Z')
			return str;
		
		// check for unix timestamp or try to parse any other given format
		var timestamp = parseInt(str)*1000;
		date = timestamp > Date.now()-3600 ? new Date(timestamp) : new Date(str);
		
		// check if date is valid
		if (date.getTime() > Date.now()-3600)
			return date.getFullYear()+('0'+(date.getMonth()+1)).substr(-2)+('0'+date.getDate()).substr(-2)+'T'+('0'+date.getHours()).substr(-2)+('0'+date.getMinutes()).substr(-2)+('0'+date.getSeconds()).substr(-2)+'Z';
		
		// nothing left
		return false;
	}
	
	/**
	 * Converts an ical object to a string with the relevant data.
	 *
	 * @param	{object}			data		Ical data
	 * @return	{string}						Converted ical string
	 *
	 */
	_setIcal(data, cb)
	{
		var that = this;
		var ical = ['DTSTAMP:' + that._getDateTime(Date.now()/1000)];
		
		// convert datetime for start / end
		var value;
		['DTSTAMP', 'DTSTART', 'DTEND'].forEach(function(key)
		{
			value = data[key] === undefined ? false : that._getDateTime(data[key]);
			if (value === false) return false;
			
			ical.push(key + ':' + value);
		});
		
		// assign frequency
		if (data['RRULE'] !== undefined)
			ical.push('RRULE:' + (typeof data['RRULE'] === 'string' ? data['RRULE'] : (data['RRULE']['FREQ'] + (data['RRULE']['UNTIL'] !== undefined ? ';' + that._getDateTime(data['RRULE']['UNTIL']) : ''))));
		
		// assign summary
		ical.push('SUMMARY:' + (data.summary !== undefined ? data.summary : (data.name !== undefined ? data.name : '')));
		
		// assemble
		return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:io.nello', 'BEGIN:VEVENT'].concat(ical, ['END:VEVENT', 'END:VCALENDAR']).join('\r\n') + '\r\n';
	}
	
	/**
	 * Sends a request to the nello API.
	 *
	 * @param	{string}		url				URL to be called
	 * @param	{string}		method			(optional) Method to be used (GET, POST, PUT or DELETE), default is GET
	 * @param	{object}		body			(optional) Body to be sent with the request, default is empty {}
	 * @param	{function}		callback		(optional) Callback function to be invoked only receiving -result: true|false, data|error: {..}- as params
	 * @param	{object}		options			(optional) additional options to set, default is empty {}
	 * @return	{object}						this
	 *
	 */
	_req(url, method, callback, body, options)
	{
		// validate token
		if (!this.token.type || !this.token.access)
			callback({result: false, error: 'No token set! Please generate token!'});
		
		// send request
		else
		{
			_request(Object.assign(options || {}, {
				url: url,
				method: method || 'GET',
				headers: {'Authorization': this.token.type + ' ' + this.token.access},
				data: body || {},
				//json: true
			}))
			.then(function(res)
			{
				if (res.data !== undefined && res.data.result !== undefined && res.data.result.success === true)
					callback({result: true, body: res.data.data});
				else
					callback({result: false, error: 'Unknown error!'});
			})
			.catch(function(err)
			{
				callback({result: false, error: err.message});
			});
		}
		
		return this;
	}
	
	/**
	 * Get the current token or generate a new one if none is existing.
	 *
	 * @param	none
	 * @return	{string|boolean}				Current token or false if not token is available
	 *
	 */
	getToken()
	{
		return !this.token.type || !this.token.access ? false : this.token;
	}
	
	/**
	 * Retrieve a new token.
	 *
	 * @param	{string}		clientId		Client ID
	 * @param	{string}		clientSecret	Client Secret
	 * @param	{function}		callback		Callback function to be invoked
	 * @return	{object}						this
	 *
	 */
	setToken(clientId, clientSecret, callback)
	{
		if (!clientId || !clientSecret)
			callback({result: false, error: 'No Client ID / Client Secret provided!'});
		
		var that = this;
		_request.post(
			'https://auth.nello.io/oauth/token/',
			_qs.stringify({'grant_type': 'client_credentials', 'client_id': clientId, 'client_secret': clientSecret}),
			{headers: {'Content-Type': 'application/x-www-form-urlencoded'}}
		)
		.then(function(res)
		{
			if (res.status === 200)
			{
				that.token = {type: res.data.token_type || null, access: res.data.access_token || null};
				callback({result: true, token: that.token});
			}
			else
				callback({result: false, error: 'Unknown error!'});
		})
		.catch(function(err)
		{
			callback({result: false, error: err.message});
		});
		
		return this;
	}
	
	/**
	 * Opens door of a location.
	 *
	 * @param	{string}		locationId		ID of the location
	 * @param	{function}		callback		(optional) Callback function to be invoked
	 * @return	{object}						this
	 *
	 */
	openDoor(locationId, callback)
	{
		return this._req("https://public-api.nello.io/v1/locations/" + locationId + "/open/", "PUT", callback || function() {});
	}
	
	/**
	 * Gets all locations.
	 *
	 * @param	{function}		callback		Callback function to be invoked
	 * @return	{object}						this
	 *
	 */
	getLocations(callback)
	{
		return this._req("https://public-api.nello.io/v1/locations/", "GET", function(res) {callback({result: res.result, locations: res.body, error: res.error})});
    }
	
	/**
	 * Gets all time windows.
	 *
	 * @param	{string}		locationId		ID of the location
	 * @param	{function}		callback		Callback function to be invoked
	 * @return	{object}						this
	 *
	 */
	getTimeWindows(locationId, callback)
	{
		var that = this;
		return this._req("https://public-api.nello.io/v1/locations/" + locationId + "/tw/", "GET", function(res)
			{
				if (res.result === true)
				{
					// convert ical-string to full data object
					res.body.forEach(function(entry, i)
					{
						res.body[i].ical = that._getIcal(entry.ical);
					});
					
					callback({result: true, timeWindows: res.body});
				}
				
				else
					callback({result: false, error: res.error});
			}
		);
	}
	
	/**
	 * Creates a time window.
	 *
	 * @param	{string}		locationId				ID of the location
	 * @param	{object}		data					Data for the time window
	 * @param	{string}		data.name				Name of the time window
	 * @param	{string|object}	data.ical				Ical data of the time window
	 * @param	{string}		data.ical.DTSTAMP		Date-Time, format YYYYMMDDTHHMMSSZ
	 * @param	{string}		data.ical.DTSTART		Date-Time, format YYYYMMDDTHHMMSSZ
	 * @param	{string}		data.ical.DTEND			Date-Time, format YYYYMMDDTHHMMSSZ
	 * @param	{string|object}	data.ical.RRULE			Frequency Rule and Until Date-Time
	 * @param	{string}		data.ical.RRULE.FREQ	Frequency Rule
	 * @param	{string}		data.ical.RRULE.UNTIL	Date-Time, format YYYYMMDDTHHMMSSZ
	 * @param	{function}		callback				(optional) Callback function to be invoked
	 * @return	{object}								this
	 *
	 */
	createTimeWindow(locationId, data, callback)
	{
		// convert ical to object
		if (typeof data.ical !== 'string')
			data.ical = this._setIcal(Object.assign(data.ical, {name: data.name}), callback);
		
		// roughly verify ical data
		if (data.ical === false || (typeof data.ical === 'string' && (data.ical.indexOf('BEGIN:VCALENDAR') === -1 || data.ical.indexOf('END:VCALENDAR') === -1 || data.ical.indexOf('BEGIN:VEVENT') === -1 || data.ical.indexOf('END:VEVENT') === -1)))
			callback({result: false, error: 'Wrong ical data provided! Missing BEGIN:VCALENDAR, END:VCALENDAR, BEGIN:VEVENT or END:VEVENT.'});
		
		// request
		return this._req(
			"https://public-api.nello.io/v1/locations/" + locationId + "/tw/",
			"POST",
			function(res) {callback(res.result === true ? {result: true, timeWindow: res.body} : {result: false, error: res.error})},
			{'name': data.name, 'ical': data.ical}
		);
	}
	
	/**
	 * Deletes a time window.
	 *
	 * @param	{string}		locationId		ID of the location
	 * @param	{string}		twId			ID of the time window
	 * @param	{function}		callback		(optional) Callback function to be invoked
	 * @return	{object}						this
	 *
	 */
	deleteTimeWindow(locationId, twId, callback)
	{
		return this._req("https://public-api.nello.io/v1/locations/" + locationId + "/tw/" + twId + "/", "DELETE", callback || function() {});
	}
	
	/**
	 * Deletes all time windows of a location.
	 *
	 * @param	{string}		locationId		ID of the location
	 * @param	{function}		callback		(optional) Callback function to be invoked (will be invoked for every deleted time window)
	 * @return	{object}						this
	 *
	 */
	deleteAllTimeWindows(locationId, callback)
	{
		var that = this;
		this.getTimeWindows(locationId, function(res)
		{
			if (res.result === true)
			{
				res.timeWindows.forEach(function(tw) {
					that._req("https://public-api.nello.io/v1/locations/" + locationId + "/tw/" + tw.id + "/", "DELETE", callback || function() {});
				});
			}
			
			// error
			else
				callback({result: false, error: 'Could not retrieve time windows'});
		});
		
		return this;
	}
	
	/**
	 * Unubscribe from events (delete a webhook)
	 *
	 * @param	{string}			locationId		ID of the location
	 * @param	{function}			callback		(optional) Callback function to be invoked
	 * @return	{object}							this
	 *
	 */
	unlisten(locationId, callback)
	{
		this.server = null;
		return this._req("https://public-api.nello.io/v1/locations/" + locationId + "/webhook/", "DELETE", callback || function() {});
	}
	
	/**
	 * Subscribe / listen to events (add a webhook)
	 *
	 * @param	{string}			locationId		ID of the location
	 * @param	{object|string}		uri				External URL including port (e.g. www.domain.com:port) of the webhook that the adapter is listening on
	 * @param	{string}			uri.url			External URL of the webhook that the adapter is listening on
	 * @param	{integer}			uri.port		External Port of the webhook that the adapter is listening on
	 * @param	{array}				actions			(optional) Actions to listen to (defaults to ['swipe', 'geo', 'tw', 'deny'])
	 * @param	{function}			callback		Callback function to be invoked
	 * @return	{object}							this
	 *
	 */
	listen(locationId, uri, callback, actions)
	{
		// convert uri to object
		if (typeof uri === 'string')
		{
			if (uri.indexOf(':') === -1)
				callback({result: false, error: 'Invalid url specified! Please specify port using ":", e.g. domain.com:PORT!'});
			
			else
				var u = {
					ssl: this.isSecure,
					url: (this.isSecure ? 'https://' : 'http://') + uri.substr(0, uri.indexOf(':')).replace(/http:\/\//gi, '').replace(/https:\/\//gi, ''),
					port: parseInt(uri.substr(uri.indexOf(':')+1))
				};
		}
		else
			var u = {
				ssl: this.isSecure,
				url: (this.isSecure ? 'https://' : 'http://') + uri.substr(0, uri.indexOf(':')).replace(/http:\/\//gi, '').replace(/https:\/\//gi, ''),
				port: parseInt(url.port)
			};
		
		// request
		u.uri = u.url + ':' + u.port;
		var that = this;
		return this._req("https://public-api.nello.io/v1/locations/" + locationId + "/webhook/", "PUT",
			function(res)
			{
				if (res.result === true)
				{
					if (that.isSecure === true)
						that.server = _https.createServer(
							{
								key: that.ssl.key.indexOf('.') === -1 ? that.ssl.key : _fs.readFileSync(that.ssl.key),
								ca: that.ssl.ca !== null ? that.ssl.ca.indexOf('.') === -1 ? that.ssl.ca : _fs.readFileSync(that.ssl.ca) : null,
								cert: that.ssl.cert.indexOf('.') === -1 ? that.ssl.cert : _fs.readFileSync(that.ssl.cert)
							},
							that._handler(callback)
						).listen(u.port);
					
					else
						that.server = _http.createServer(that._handler(callback)).listen(u.port);
					
					callback({result: true, uri: u});
				}
				
				else
					callback({result: false, error: res.error});
			},
			{'url': u.uri, 'actions': actions || ['swipe', 'geo', 'tw', 'deny']},
			that.isSecure ? {rejectUnauthorized: that.ssl.selfSigned} : {}
		);
	}
}

module.exports = Nello;
