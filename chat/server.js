// Parameters
var parameters = {
	// Welcome Message!!!
	motd: 'Welcome to my web chat server!\nPeople online: [online_count], take a look who is online: [online];',
	// Message limit for 10 second (a person can send 3 messages for a second) 
	messagerate: 17,
}

// Create the WebSocket server
var ipaddress = 'localhost';
var WebSocketServer = require('./node_modules/ws').Server,
	wss = new WebSocketServer({host: ipaddress, port: 9000});

// Database connection
var MongoClient = require('./node_modules/mongodb').MongoClient,
	format = require('util').format;

var userListDB, chatDB;

// Connecting to database
MongoClient.connect('mongodb://127.0.0.1:27017', function (err, db) {
	if (err) {throw err}

	// write references to tables (collections) in the global variables
	userListDB = db.collection('users');
	chatDB = db.collection('chat');
});
// checking if the user exists in the database
function existUser (user, callback) {
	userListDB.find({login: user}).toArray(function (error, list) {
		callback (list.length !== 0);
	});
}
// this function is entirely responsible for all account system
function checkUser (user, password, callback) {
	// check whether there is a user with the same login
	existUser(user, function (exist) {
		// if user is already in the database
		if (exist) {
			// then let's find his records in database
			userListDB.find({login: user}).toArray(function (error, list) {
				// check the password
				callback (list.pop().password === password);
			});
		} else {
			// if there is not such a user, then register him 
			userListDB.insert ({login: user, password: password, color: get_random_color()}, {w:1}, function (err) {
				if (err) {throw err}
			});
			// skip the authorization, let him log in right now
			callback (true);
		}
	});
}

var colors = {};
//function creates an array of colors, checks if the user and its color in the array,
//adds color for a name if it was not in the array, sends callback with the color
function colorOf (name, callback){
	if (name == '[server]') {
		callback('transparent');
		return;
	}
	if (!colors[name]) {
		userListDB.find({login: name}).toArray(function (error, list) {
			usr = list.pop();
			if (!usr.color) {
				color = get_random_color ()
				userListDB.update({ login: name }, {$set: {color: color}}, function () {});
			} else {
				color = usr.color;
			}
			colors[name] = color;
			callback (color);
		});
	} else {
		callback (colors[name]);
	}
}
//this function gets random color
function get_random_color() {
	var letters = '0123456789ABCDEF'.split('');
	var color = '#';
	for (var i = 0; i < 6; i++ ) {
		color += letters[Math.round(Math.random() * 15)];
	}
   	return color;
}
// this funtion pushes messages to everyone in the chat and save the message to the database
function broadcast (by, message) {

	// write our time in the variable
	var time = new Date().getTime();

	colorOf (by, function (color) {
		// sending to every connection opened
		peers.forEach (function (ws) {
			try { // asynchrony is not always good, try catch the exception
				  // Send JSON object via WebSocket
				ws.send (JSON.stringify ({
					type: 'message',
					message: message,
					from: by,
					time: time,
					color: color
				}));
			} catch (e) {}
		});

		if (by == '[server]') {
			return;
		}

		// Save the message in the history/database
		chatDB.insert ({message: message, from: by, time: time, color: color}, {w:1}, function (err) {
			if (err) {throw err}
		});
	});
}

// colors of users
var colors = [];
// list of users of chat, their logins
var lpeers = [];
var peers = [];
// this funtion sends old messages to the new user
function sendNewMessages (ws, cb) {
	chatDB.find().sort({time:-1}).limit(50).toArray(function(error, entries) {
		if (error) {throw error;}
		entries = entries.reverse();
		entries.forEach(function (entry){
			entry.type = 'message';
			try {
				ws.send (JSON.stringify (entry));
			} catch (e) {}
		});
		cb();
	});
}

// убрать из массива элемент по его значению
// далеки следят за вами
Array.prototype.exterminate = function (value) {
	this.splice(this.indexOf(value), 1);
}

// when we have a new connection
wss.on('connection', function (ws) {
	// initialize variables
	var login = '';
	var registered = false;	

	// when we have an incoming message
	ws.on('message', function (message) {		

		// Recieve event in suitable form, parsing
		var event = JSON.parse(message);

		// If a person wants to athorize, we check his data
		if (event.type === 'authorize') {
			// Checking his data
			checkUser(event.user, event.password, function (success) {
				// Make a separate variable that will carry information about successful authorization
				registered = success;

				// Preparing the response event for the client
				var returning = {type:'authorize', success: success};

				// if the user passed the checking
				if (success) {
					// Add to response event the list of people online
					returning.online = [].concat(lpeers); // Copy the array

					// Add the joined user to the list of online people
					lpeers.push (event.user);

					// Add the link to the WebSocket in the list of connections
					peers.push (ws);

					// Make a separate variable that will carry information about login name/nickname
					login = event.user;
					//Joined the chat notification
					broadcast('[server]', login+' joined the chat!');

					// Left the chat notification and extermination from the list of connections and list of logins
					ws.on ('close', function () {
						peers.exterminate(ws);
						lpeers.exterminate(login);
						broadcast('[server]', login+' left the chat!');
					});
				}

				// Finally, send the response even
				ws.send (JSON.stringify(returning));

				// Send all old messages to the new user
				if (success) {
					sendNewMessages(ws, function(){

						// and also send the message of the day and welcome message
						ws.send (JSON.stringify ({
							type: 'message',
							message: parameters.motd,
							from: '[server]',
							time: Date.now(),
							color: 'transparent'
						}));
					});
				}
			});
		}
		// If the message's type is not "authorize", do following
		else {
			// If the person is not registered, ignore him
			if (registered) {
				// Check the event type
				switch (event.type) {
					// If the type is just a message
					case 'message':
						// Send it to all chat participants
						broadcast (login, event.message)
						break;
					//  If the message about that the user is typing
					case 'type':
						// Space for the further features
						break;
				}
			}
		}
	});
});
