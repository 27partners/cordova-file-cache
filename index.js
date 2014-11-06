var hash = require('./murmerhash');
var Promise = null;

function FileCache(options){
  // cordova-promise-fs
  this._fs = options.fs;
  if(!this._fs) {
    throw new Error('Missing required option "fs". Add an instance of cordova-promise-fs.');
  }
  // Use Promises from fs.
  Promise = this._fs.Promise;

  // 'mirror' mirrors files structure from "serverRoot" to "localRoot"
  // 'hash' creates a 1-deep filestructure, where the filenames are hashed server urls (with extension)
  this._mirrorMode = options.mode !== 'hash';

  // normalize path
  this._localRoot = options.localRoot || 'data';
  this._serverRoot = options.serverRoot || '';
  if(this._localRoot[this._localRoot.length -1] !== '/') this._localRoot += '/';
  if(this._localRoot[0] !== '/') this._localRoot = '/' + this._localRoot;
  if(this._serverRoot && this._serverRoot[this._serverRoot.length -1] !== '/') this._serverRoot += '/';

  // set internal variables
  this._downloading = [];    // download promises
  this._added = [];          // added files
  this._cached = {};         // cached files

  // list existing cache contents
  this.ready = this.list();
}

/**
 * Helper to cache all 'internalURL' and 'URL' for quick synchronous access
 * to the cached files.
 */
FileCache.prototype.list = function list(){
  var self = this;
  return new Promise(function(resolve,reject){
    self._fs.list(self._localRoot,'rfe').then(function(entries){
      self._cached = {};
      entries = entries.map(function(entry){
        self._cached[entry.fullPath] = {
          toInternalURL: entry.toInternalURL(),
          toURL: entry.toURL(),
        };
        return entry.fullPath;
      });
      resolve(entries);
    },reject);
  });
};

FileCache.prototype.add = function add(urls){
  if(typeof urls === 'string') urls = [urls];
  var self = this;
  urls.forEach(function(url){
    if(self._added.indexOf(url) === -1) {
      self._added.push(self.toServerURL(url));
    }
  });
  return self.isDirty();
};

FileCache.prototype.remove = function remove(urls){
  if(typeof urls === 'string') urls = [urls];
  var self = this;
  urls.forEach(function(url){
    var index = self._added.indexOf(self.toServerURL(url));
    if(index >= 0) self._added.splice(index,1);
    var path = self.toPath(url);
    self._fs.remove(path);
    delete self._cached[path];
  });
  return self.isDirty();
};

FileCache.prototype.getDownloadQueue = function(){
  var self = this;
  var queue = self._added.filter(function(url){
    return !self.isCached(url);
  });
  return queue;
};

FileCache.prototype.getAdded = function() {
  return this._added;
};

FileCache.prototype.isDirty = function isDirty(){
  return this.getDownloadQueue().length > 0;
};

FileCache.prototype.download = function download(onprogress){
  var fs = this._fs;
  var self = this;
  self.abort();

  return new Promise(function(resolve,reject){
    // make sure cache directory exists and that
    // we have retrieved the latest cache contents
    // to avoid downloading files we already have!
    fs.ensure(self._localRoot).then(function(){
      return self.list();
    }).then(function(){
      // no dowloads needed, resolve
      if(!self.isDirty) {
        resolve(self);
        return;
      }
      
      // keep track of number of downloads!
      var queue = self.getDownloadQueue();
      var index = self._downloading.length;
      var total = self._downloading.length + queue.length;

      // augment progress event with index/total stats
      var onSingleDownloadProgress;
      if(typeof onprogress === 'function') {
        onSingleDownloadProgress = function(ev){
          ev.index = this.index;
          ev.total = total;
          onprogress(ev);
        };
      }

      // callback
      var onDone = function(){
        index++;
        console.log('done',index,total);
        // when we're done
        if(index !== total) {
          // reset downloads
          self._downloading = [];
          // check if we got everything
          self.list().then(function(){
            // Yes, we're not dirty anymore!
            if(!self.isDirty()) {
              resolve(self);
            // Aye, some files got left behind!
            } else {
              reject(self.getDownloadQueue());
            }
          },reject);
        }
      };

      // download every file in the queue (which is the diff from _added with _cached)
      queue.forEach(function(url,index){
        console.log('download',url,self.toPath(url));
        var download = fs.download(url,self.toPath(url),onSingleDownloadProgress.bind({index:index}));
        download.then(onDone,onDone);
        self._downloading.push(download);
      });
    },reject);
  });
};

FileCache.prototype.abort = function abort(){
  this._downloading.forEach(function(download){
    download.abort();
  });
  this._downloading = [];
};

FileCache.prototype.isCached = function isCached(url){
  url = this.toPath(url);
  return !!this._cached[url];
};

FileCache.prototype.clear = function clear(){
  this._cached = {};
  return this._fs.removeDir(this._localRoot);
};

/**
 * Helpers to output to various formats
 */
FileCache.prototype.toInternalURL = function toInternalURL(url){
  path = this.toPath(url);
  return this._cached[path]? this._cached[path].toInternalURL: url;
};

FileCache.prototype.get = FileCache.prototype.toInternalURL;

FileCache.prototype.toDataURL = function toDataURL(url){
  return this._fs.toDataURL(this.toPath(url));
};

FileCache.prototype.toURL = function toInternalURL(url){
  path = this.toPath(url);
  return this._cached[path]? this._cached[path].toURL: url;
};

FileCache.prototype.toServerURL = function toServerURL(path){
  return path.substr(0,4) !== 'http'? this._serverRoot + path: path;
};

/**
 * Helper to transform remote URL to a local path (for cordova-promise-fs)
 */
FileCache.prototype.toPath = function toPath(url){
  if(this._mirrorMode) {
    len = this._serverRoot.length;
    if(url.substr(0,len) !== this._serverRoot) {
      if(url[0] === '/') url = url.substr(1);
      return this._localRoot + url;
    } else {
      return this._localRoot + url.substr(len);
    }
  } else {
    if(url.substr(0,4) !== 'http') {
      throw new Error('Invalid url. Must start with "http".');
    } else {
      return this._localRoot + hash(url) + url.substr(url.lastIndexOf('.'));
    }
  }
};

module.exports = FileCache;