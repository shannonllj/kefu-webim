easemobim.liveStreaming = (function(){
	var utils = easemobim.utils;
	var imChat = document.getElementById('em-kefu-webim-chat');
	var btnVideoInvite = document.querySelector('.em-live-streaming-invite');
	var bar = document.querySelector('.em-live-streaming-bar');
	var videoWrapper = document.querySelector('.em-live-streaming-wrapper');
	var btnExit = videoWrapper.querySelector('.btn-exit');
	var video = videoWrapper.querySelector('video');
	var timeSpan = videoWrapper.querySelector('.status-panel .time');

	var sourceURL = 'http://vlive3.hls.cdn.ucloud.com.cn/ucloud/cyy-111/playlist.m3u8';
	var config = null;
	var sendMessageAPI = null;

	var closingTimer = {
		delay: 3000,
		start: function(){
			var me = this;
			setTimeout(function(){
				imChat.classList.remove('has-live-streaming');
				videoWrapper.classList.add('hide');
			}, me.delay);
		}
	}

	var statusPoller = {
		timer: null,
		interval: 3000,
		streamId: '',
		status: 'IDLE',
		start: function(streamId){
			var me = this;
			setTimeout(this.fn, 0);
			this.timer = setInterval(fn, this.interval);
			function fn(){
				updateStatus(me.status, streamId);
			}
		},
		stop: function(){
			this.timer && clearInterval(this.timer);
			this.timer = null;
			this.updateStatus('IDLE');
		},
		updateStatus: function(status){
			this.status = status;
		}
	};

	var autoReload = {
		timer: null,
		interval: 500,
		timeout: 5000,
		timeStamp: Infinity,
		start: function(){
			var me = this;
			this.updateTimeStamp();
			this.timer = this.timer || setInterval(function(){
				console.log('check progress');
				var diff = (new Date()).getTime() - me.timeStamp;
				if (diff > me.timeout && !video.paused){
					console.log('reload video');
					me.updateTimeStamp();
					video.src = sourceURL;
					video.play();
				}
			}, this.interval);
		},
		stop: function(){
			this.timer && clearInterval(this.timer);
		},
		updateTimeStamp: function(){
			this.timeStamp = (new Date().getTime());
		}
	};

	// fake 解决某些型号手机的时间自动清零问题
	var timeAccumulator = {
		lastCurrentTime: 0,
		accumulatedTime: 0,
		update: function(){
			var delta = video.currentTime - this.lastCurrentTime;
			if (delta >= 0){
				this.accumulatedTime += delta;
			}
			else {
				// 初始时间不要累加，否则导致时间会超前于推流端
				// this.accumulatedTime += video.currentTime;
			}
			this.lastCurrentTime = video.currentTime;
			return this.accumulatedTime;
		},
		init: function(){
			this.lastCurrentTime = 0;
			this.accumulatedTime = 0;
		}
	}

	function autoResize(width, height){
		var LIMIT = {
			width: 240,
			height: 240
		};

		var targetAspectRadio = width / height;
		var currentAspectRadio = LIMIT.width / LIMIT.height;

		if (currentAspectRadio > targetAspectRadio){
			video.style.width = Math.floor(LIMIT.height * targetAspectRadio) + 'px';
		}
		else {
			video.style.height = Math.floor(LIMIT.width / targetAspectRadio) + 'px';
		}

	}

	function bindEvent(){
		btnVideoInvite.addEventListener('click', function(){
			sendMessageAPI('txt', '邀请您进行实时视频', false, null);
		}, false);
		btnExit.addEventListener('click', function(evt){
			statusPoller.updateStatus('IDLE');
			video.pause();
			videoWrapper.classList.add('hide');
		}, false);
		bar.addEventListener('click', function(e){
			video.src = sourceURL;
			statusPoller.updateStatus('PLAYING');
			// autoReload.start();
			video.play();			
			videoWrapper.classList.remove('hide');
		}, false);
		video.addEventListener('loadeddata', function(e){
			console.log(e.type);
			console.log('size', video.videoWidth, video.videoHeight);
			autoResize(video.videoWidth, video.videoHeight);
		}, false);
		video.addEventListener('timeupdate', function(e){
			var cached = format(timeAccumulator.update());
			// var cached = format(video.currentTime);
			if(timeSpan.innerHTML !== cached){
				timeSpan.innerHTML = cached;
			}
			function format(second){
				return (new Date(second * 1000))
					.toISOString()
					.slice(-'00:00.000Z'.length)
					.slice(0, '00:00'.length);
			}
		}, false);
		// video.addEventListener('progress', function(e){
		// 	autoReload.updateTimeStamp();
		// }, false);
	}

	function initDebug(){
		[
			'loadedmetadata',
			'loadstart',
			'stalled',
			'canplaythrough',
			'suspend',
			'pause',
			'playing',
			'error',
			'waiting',
			'progress',
			'webkitbeginfullscreen',
			'webkitendfullscreen'
		].forEach(function(eventName){
			video.addEventListener(eventName, function(e){
				console.log(e.type, e);
			});
		});
	}

	function updateStatus(status, streamId){
		easemobim.api('mediaStreamUpdateStatus', {
			visitorUpdateStatusRequest: {
				status: status
			},
			streamId: streamId
		}, function(res){
			var status = res.data
				&& res.data.visitorUpdateStatusResponse
				&& res.data.visitorUpdateStatusResponse.status;
			var streamUri = res.data.visitorUpdateStatusResponse.streamUri;

			switch(status){
				// 坐席端开始推流
				case 'STARTED':
					readyToPlay(streamUri);
					break;
				// 坐席端停止推流
				case 'STOPPED':
				// 坐席端推流异常
				case 'ABNORMAL':
					bar.classList.remove('playing');
					videoWrapper.classList.remove('playing');
					timeSpan.innerHTML = '00:00';
					statusPoller.stop();
					// autoReload.stop();
					video.pause();
					video.src = '';
					closingTimer.start();
					utils.set('streamId', '');
					break;
				// 坐席端初始化，未开始推流，忽略此状态
				case 'INIT':
				default:
					break;
			}
		});
	}

	function readyToPlay(streamUri){
		sourceURL = streamUri;
		bar.classList.add('playing');
		videoWrapper.classList.add('playing');
		imChat.classList.add('has-live-streaming');
	}

	return {
		init: function(chat, sendMessage, cfg){
			sendMessageAPI = sendMessage;
			config = cfg;

			// 按钮初始化
			btnVideoInvite.classList.remove('hide');
			bindEvent();
			initDebug();

			var streamId = utils.get('streamId');
			if (streamId){
				statusPoller.start(streamId);
			}
		},
		open: function(streamId) {
			statusPoller.start(streamId);
			timeAccumulator.init();
			utils.set('streamId', streamId, 1);
		},
		onOffline: function() {
			// for debug
			console.log('onOffline');
		}
	}
}());

// 约定的文本消息，用以访客端获取streamId
// {
// 	ext: {
// 		type: 'live/video',
// 		msgtype: {
// 			streamId: '9c8b5869-795e-4351-8f1a-7dbb620f108c'
// 		}
// 	}
// }
