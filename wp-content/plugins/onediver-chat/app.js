/*
 * Onediver Chat Module
 */

angular.module('od.chat_app', ['firebase'])

.controller('ChatController', ['$scope', '$http', 'Config', '$firebaseArray', '$firebaseObject', '$cookies', '$timeout',
	function($scope, $http, Config, $firebaseArray, $firebaseObject, $cookies, $timeout) {

	var fireRef = new Firebase(Config.firebase_url);
	$scope.chat = {
		logged: false,
		roomId: null,
		roomMeta: null,
		roomRef: null,
		messages: [],
		reference: null,
		typing_timeout: null,
		auth: null,
		visible: true,
		minimize: true,
		connecting: false,
		loading: false,
		time_format: 'hh:mm a',
		failed: false
	};

	fireRef.onAuth(function(authData) {
		$scope.chat.auth = authData;
		console.log(authData);

		if ($scope.chat.auth) {

			$scope.chat.loading = true;

			// create room and initiate chat
			//$scope.chat.reference = new Firechat(fireRef);

			var roomId = jQuery.cookie('odchat-roomid');

			if (roomId) {
				$scope.chat.roomId = roomId;
				$scope.chat.roomRef = fireRef.child('room-metadata/' + roomId);

				// retrieve room messages
				$scope.chat.logged = true;
				$scope.chat.minimize = false;
				$scope.chat.messages = $firebaseArray(fireRef.child('room-messages/' + roomId).orderByPriority().limitToLast(20));

				$scope.chat.messages.$loaded().finally(function() {
					$scope.chat.loading = false;
				});

				// setup presence
				var roomRef = fireRef.child('room-metadata/' + roomId),
					presenceRef = roomRef.child('online');

				$scope.chat.roomRef = roomRef;
				$scope.chat.roomMeta = $firebaseObject(roomRef);

				fireRef.child('room-typing/' + roomId).on('value', function(snapshot) {
					$timeout(function() {
						if (snapshot.val()) {
							$scope.chat.roomMeta.typing = snapshot.val();
						}
					}, 0);
				});

				fireRef.root().child('.info/connected').on('value', function(snapshot) {
					if (snapshot.val() === true) {
						presenceRef.onDisconnect().set(false);
						presenceRef.set(true);
					}
				});

				fireRef.child('room-typing/' + roomId + '/' + $scope.chat.auth.uid).onDisconnect().set(false);

				fireRef.child('room-metadata').child(roomId).child('numMessages').on('value', function(snapshot) {
					jQuery('#odChatboxMessageBox').stop().animate({
						scrollTop: jQuery("#odChatboxMessageBox")[0].scrollHeight
					}, 800);
				});

				// post to page visited
				// TODO: can do this directly
				/*if ($scope.chat.logged) {
					jQuery.post(
						Config.wp_ajax_url,
						{
							action: 'odchat_page_visit',
							room_id: roomId
						},
						function(data, status) {
							console.log(data);
						}
					);
				}*/
			}
		}
	});

	// TODO: can store token in cookie and resume session later using that token

	$scope.enter_room = function() {
		if (!$scope.chat.name || $scope.chat.name.length <= 0) {
			alert('Please enter a name first');
			return;
		}

		$scope.chat.connecting = true;

		// get firebase token from server
		jQuery.post(
			Config.wp_ajax_url,
			{
				action: 'odchat_request_token',
				name: $scope.chat.name,
				email: $scope.chat.email,
				subject: $scope.chat.subject,
				_wpnonce: Config.wp_nonce
			},
			function(data, status) {

				if (!data.room) {
					$timeout(function() {
						$scope.chat.failed = true;
					}, 0);

					throw "No Room Defined";
				}

				// login user
				//fireRef.$scope.chat.authAnonymously(function(error, $scope.chat.authDate) {
				fireRef.authWithCustomToken(data.token, function(error, auth) {
					if (error) {
						// notify user of error
						// possibly log file or inform devs
						return;
					}

					var message = null;

					// transform tags using template
					if (angular.isString(Config.welcome_message) && Config.welcome_message.trim().length > 0) {
						function capitalize(str) {
							return str.charAt(0).toUpperCase() + str.slice(1);
						}

						var tags = {
								'visitor_name': capitalize($scope.chat.name),
								'shop_name': Config.shop_name
							};

						message = Config.welcome_message,
						//console.log(message);

						angular.forEach(tags, function(replacement, tag) {
							//console.log(tag);
							//console.log(replacement);
							message = message.replace('[' + tag + ']', replacement || '');
						});
						//console.log(message);
					}

					if (message != null) {
						// send welcome message
						var messageMeta = {
							userId: 1,
							name: 'system',
							timestamp: Firebase.ServerValue.TIMESTAMP,
							message: message,
							type: 'system'
						};
						$scope.chat.messages.$add(messageMeta);
					}

					// update room meta
					console.log('updating from auth listener');
					var meta = {
						lastMessage: message,
						lastTime: Firebase.ServerValue.TIMESTAMP,
						lastVisitorMessaged: true
					};

					console.log('update meta including lastVisitorMessaged...');
					fireRef.child('room-metadata/' + $scope.chat.roomId).update(meta);
				});

				// store roomID
				jQuery.cookie('odchat-roomid', data.room, {path: '/'});
			}
		);
	}

	// close conversation to mark user is not going to return
	$scope.exit_chat = function() {
		if (!confirm('Are You Sure you want to exit chat?')) {
			return;
		}

		// TODO: should be an api call function?
		var messageMeta = {
			userId: 1,
			name: 'System',
			timestamp: Firebase.ServerValue.TIMESTAMP,
			message: 'Chat closed by visitor',
			//hide_public: true,
			type: 'system'
        };

		fireRef.child('room-messages').child($scope.chat.roomId).push(messageMeta);

		var roomMeta = {
			closed: true,
			online: false,
			closedTime: Firebase.ServerValue.TIMESTAMP,
			closedByAdmin: false
		};

		fireRef.child('room-metadata').child($scope.chat.roomId).update(roomMeta);

		jQuery.removeCookie('odchat-roomid');
	}

	// when admin closes the chat
	// does cleanup like deleting cookie so user can initiate new chat again on refresh
	$scope.close_chat = function() {
		jQuery.removeCookie('odchat-roomid');
		location.reload();
	}

	$scope.add_message = function(message) {
		if (!message || message.trim().length <= 0) {
			return;
		}

        var messageMeta = {
			userId: $scope.chat.auth.auth.uid,
			name: $scope.chat.auth.auth.username,
			timestamp: Firebase.ServerValue.TIMESTAMP,
			message: message,
			type: 'default',
			isPublic: true
        };

		$scope.chat.messages.$add(messageMeta);

		// update meta
		fireRef.child('room-metadata/' + $scope.chat.roomId + '/numMessages').transaction(function(numMessages) {
			return (numMessages || 0) + 1;

		}, function(error, committed, snapshot) {

			// update room meta indicators
			if (!error && committed) {
				var meta = {
					lastMessage: message,
					lastTime: Firebase.ServerValue.TIMESTAMP
				};

				fireRef.child('room-metadata/' + $scope.chat.roomId).update(meta);
			}

			// mark room as unread on admin side
			$scope.chat.roomRef.child('viewers').once('value', function(snapshot) {
				console.log(snapshot.val());
				console.log(snapshot.numChildren());
				if (!snapshot.numChildren()) {
					console.log('settings lastVisitorMessaged...');
					fireRef.child('room-metadata/' + $scope.chat.roomId + '/lastVisitorMessaged').set(true);
				}
			});

			fireRef.child('room-typing/' + $scope.chat.roomId + '/' + $scope.chat.auth.uid).set(false);
		});

		$scope.chat.message = '';

		return true;
	}

	// Typing Intent
	$scope.set_typing = function() {
		if ($scope.chat.typing_timeout) {
			$timeout.cancel($scope.chat.typing_timeout);
			$scope.chat.typing_timeout = null;
		}

		fireRef.child('room-typing/' + $scope.chat.roomId + '/' + $scope.chat.auth.uid).set(true);
		$scope.chat.typing_timeout = $timeout(function() {
			$scope.chat.typing_timeout = null;
			fireRef.child('room-typing/' + $scope.chat.roomId + '/' + $scope.chat.auth.uid).set(false);
		}, 800);
	}

	$scope.has_typing = function() {
		var flag = false;

		if ($scope.chat.roomMeta && $scope.chat.roomMeta.typing) {
			angular.forEach($scope.chat.roomMeta.typing, function(val, key) {
				if (val && key !== $scope.chat.auth.uid) {
					flag = true;
				}
			});
		}

		return flag;
	}

	$scope.hide_chat = function() {
		$scope.chat.visible = false;
	}
}]);
