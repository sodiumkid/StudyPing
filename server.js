const express = require("express");
const multer = require('multer');
const app = express();
const fs = require('fs');
const path = require('path');
const pug = require('pug');
const bodyParser = require('body-parser');
const formidable = require('formidable');
const async = require('async');
const cloudinary = require('cloudinary')
const passport = require('passport');
const bcrypt = require('bcrypt');
const flash = require('express-flash')
const session = require('express-session')
const methodOverride = require('method-override')
const mysql = require('mysql2/promise');
const initializePassport = require('./passport-config.js');
const http = require('http');
const https = require('https');

require('dotenv').config()

app.use(express.urlencoded({ extended: false }))
app.use(flash())
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}))

// Login stuff
app.use(passport.initialize())
app.use(passport.session())
app.use(methodOverride('_method'))

// Setup mysql for data
var pool = mysql.createPool({
  host: process.env.HOST,
  user: process.env.USER,
  password: process.env.PASSWORD,
  database: process.env.DATABASE,
  port: 3306
});

// setup cloudinary for image storage
cloudinary.config({
  cloud_name: process.env.NAME,
  api_key: process.env.KEY,
  api_secret: process.env.SECRET
});

// Setup login with passport.js
initializePassport(passport, async function(name) {
    let connection;
    try {
        connection = await pool.getConnection();
        result = await pool.query("SELECT * FROM users WHERE name = ?", name);
    } catch(e) {
        // log the error and the rethrow so the caller gets it
        console.log(e);
        throw e;
    } finally {
        connection.release();
        return result[0][0];
    }
  },

  async function(id) {
      let connection;
      try {
          connection = await pool.getConnection();
          result = await pool.query("SELECT * FROM users WHERE id = ?", id);
      } catch(e) {
          // log the error and the rethrow so the caller gets it
          console.log(e);
          throw e;
      } finally {
          connection.release();
          return result[0][0];
      }
  }
);

// extend limit: doesn't work if we don't
app.use(bodyParser.json({limit: '20mb'}));
app.use(bodyParser.urlencoded({
   limit: '100mb',
   extended: true
}));

// Using pug instead of html
app.engine('pug', require('pug').__express)
app.set('view engine', 'pug')

// Setting up uploading
var storage = multer.diskStorage({
  // file upload destination
  destination: function (req, file, callback) {
    callback(null, './files/');
  },
  filename: function (req, file, callback) {
    callback(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
  }
});
var upload = multer({ storage : storage}).single('file');

// Home welcome page
app.get('/', checkNotAuthenticated, function(req,res){
  res.render('welcome', { logged: req.isAuthenticated() });
});

// Initial register page
app.get('/register',function(req,res){
    res.render('register', { logged: false});
});

// Displays the same as the last but with error message
app.get('/register/:errormes',function(req,res){
    var message;
    if (req.params.errormes == "exists") {
      message = "Error: User with email already exists"
    }
    if (req.params.errormes == "userexists") {
      message = "Error: Username taken"
    }
    res.render('register', { logged: false, message: message});
});

// Go and register user with mysql
app.post('/register', async (req, res) => {
  let connection;
  // First check if user with email or username exists already
  try {
      connection = await pool.getConnection();
      let result = await pool.query("SELECT * FROM users WHERE email = ?", req.body.email);
      if (result[0][0] != null) {
        return res.redirect("/register/exists")
      }
      nameres = await pool.query("SELECT * FROM users WHERE name = ?", req.body.name);
      if (nameres[0][0] != null) {
        return res.redirect("/register/userexists")
      }

  } catch(e) {
      // log the error and the rethrow so the caller gets it
      console.log(e);
      throw e;
  } finally {
     connection.release();
  }
  // Now record
  const hashedPassword = await bcrypt.hash(req.body.password, 10)
  try {
      connection = await pool.getConnection();
      let result = await pool.query("INSERT INTO users (name, email, password, followers) VALUES(?, ?, ?, ?)", [req.body.name, req.body.email, hashedPassword, "[]"]);
  } catch(e) {
      // log the error and the rethrow so the caller gets it
      console.log(e);
      throw e;
  } finally {
      connection.release();
      res.redirect('/login')
      res.end();
  }
})

// Follow request button
app.post('/user/:userID', checkAuthenticated, async function(req,res){
  try {
      var name;
      await req.user.then(function(resultN) {
        name = resultN.name;
      });
      connection = await pool.getConnection();
      userFiles = await pool.query("SELECT followers FROM users WHERE name = ?", req.params.userID);
      console.log(userFiles[0][0].followers)
      var newArr = JSON.parse(userFiles[0][0].followers);
      var unfollow = false;
      for (var i = 0; i < newArr.length; i++) {
        if (newArr[i] == name) {
          unfollow = true;
          newArr.splice(i, 1);
          console.log(newArr)
          break;
        }
      }
      if (unfollow == false) {
        newArr.push(name);
      }
      newARR = JSON.stringify(newArr);
      result = await pool.query("UPDATE users SET followers = ? WHERE name = ?", [newARR, req.params.userID]);
  } catch(e) {
      // log the error and the rethrow so the caller gets it
      console.log(e);
      throw e;
  } finally {
      connection.release();
      res.redirect('/user/'+req.params.userID)
      res.end();
  }
})

// Get user page - this is also the /profile page
app.get('/user/:userID', async function(req,res){
    var rep = 0;
    var files = [];
    var fileNames = [];
    var fileIds = [];
    var thumbnails = [];
    var descriptions = [];
    var uploaders = [];
    var subjects = [];
    var comments = [];
    var count = 0;
    var votes = [];
    var isSelf = false;
    var logged = await req.isAuthenticated();
    var followed = false;
    var selfName;

    if (logged) {
      await req.user.then(function(resultN) {
        selfName = resultN.name;
        if (resultN.name == req.params.userID) {
          isSelf = true;
        }
      });
    }

    // Calculate user's reputation
    try {
        connection = await pool.getConnection();
        userFiles = await pool.query("SELECT * FROM files WHERE uploader = ?", req.params.userID);
        userId = await pool.query("SELECT * FROM users WHERE name = ?", req.params.userID);
        if (logged) {
          tempfol = await pool.query("SELECT followers FROM users WHERE name = ?", req.params.userID);
          tempfol = JSON.parse(tempfol[0][0].followers);
          for (var i = 0; i < tempfol.length; i++) {
            if (tempfol[i] == selfName) {
              followed = true;
              break;
            }
          }
        }
    } catch(e) {
        // log the error and the rethrow so the caller gets it
        console.log(e);
        throw e;
    } finally {
        connection.release();
    }
    if (userId[0][0] == null) {
      return res.render('profile', {error: true, logged: logged})
    }
    if (userFiles[0][0] == null) {
      rep = 0
      return res.render('profile', {followed: followed, nofiles: true, isSelf: isSelf, followers: JSON.parse(userId[0][0].followers).length, name: req.params.userID, id : 500 + userId[0][0].id, rep : rep, logged: logged})
    }
    else {
      for (var i = 0; i < userFiles[0].length; i++) {
        files.push(userFiles[0][i].dbname)
        thumbnails.push(userFiles[0][i].thumbnail);
        fileNames.push(userFiles[0][i].name);
        descriptions.push(userFiles[0][i].description);
        uploaders.push(userFiles[0][i].uploader);
        fileIds.push(userFiles[0][i].id);
        subjects.push(userFiles[0][i].subject);
        comments.push(JSON.parse(userFiles[0][i].comments).length);
        votes.push(JSON.parse(userFiles[0][i].up).length - JSON.parse(userFiles[0][0].down).length);
        rep += (JSON.parse(userFiles[0][i].up).length - JSON.parse(userFiles[0][i].down).length)
      }
    }
    console.log("LOGGED: "+ logged)
    return res.render('profile', { followed: followed, logged: logged, nofiles: false, isSelf: isSelf, name: req.params.userID, id : 500 + userId[0][0].id, rep : rep, votes: votes, comments: comments, subjects: subjects, thumbnails: thumbnails, files: files, uploaders: uploaders, descriptions: descriptions, fileNames : fileNames, fileIds : fileIds, followers: JSON.parse(userId[0][0].followers).length });
    res.end();
});


// For if user goes to their own user page, redirects to personal user
app.get('/profile', checkAuthenticated, async function(req,res){
  await req.user.then(function(resultN) {
    res.redirect('/user/'+resultN.name);
    res.end();
  });
});

// Render Login
app.get('/login', checkNotAuthenticated, function(req,res){
  res.render('login', { logged: req.isAuthenticated() });
});

// Check if login works
app.post('/login', checkNotAuthenticated, passport.authenticate('local', {
  successRedirect: '/profile',
  failureRedirect: '/login',
  failureFlash: true
}))

// Logout with POST delete
app.delete('/logout', (req, res) => {
  req.logOut()
  res.redirect('/login')
})

// Functions for checking if logged in or not
function checkAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next()
  }
  res.redirect('/login')

}

function checkNotAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect('/profile')
  }
  next()
}

// Simple upload form
app.get('/upload',checkAuthenticated, function(req,res){
    res.render('upload', { logged: true });
});

// Actually upload files to cloudinary and data to mysql
app.post('/upload',checkAuthenticated, async function(req,res){
  var ans;
  fields = [];
  new formidable.IncomingForm().parse(req)
    .on('field', (field, value) => {
      //console.log('Field', name, field)
      fields.push([field, value]);
    })
    .on('file', (name, file) => {
      var uploaderName;
      req.user.then(function(resultN) {
        uploaderName = resultN.name;
      });
      cloudinary.v2.uploader.upload(file.path,{folder: "files", resource_type: "auto"},async function(error, result) {
          var nameOf = result.public_id + ".png";
          var thumbnail = cloudinary.url(nameOf, {width: 400, height: 500, crop: "fill"})
          var keywords = fields[0][1] + fields[1][1] + fields[2][1]
          let connection;


          try {
              connection = await pool.getConnection();
              let comments = JSON.stringify([]);
              let doneUp = await pool.query("INSERT INTO files (name, dbname, thumbnail, uploader, subject, description, keywords, comments, up, down) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [fields[0][1], result.url, thumbnail, uploaderName, fields[1][1], fields[2][1], keywords, comments, comments, comments]);
          } catch(e) {
              // log the error and the rethrow so the caller gets it
              console.log(e);
              throw e;
          } finally {
              connection.release();
              res.render('success', { words: fields[0][1], logged: true, thumbnail: thumbnail })
              res.end();
          }
      });
    })
    .on('aborted', () => {
      console.error('Request aborted by the user')
    })
    .on('error', (err) => {
      console.error('Error', err)
      throw err
    })
});

// Display the pdf
app.post('/download', function(req, res) {
  try {
    http.get(req.body.image, function(file) {
      file.pipe(res);
    });
  } catch(err) {
    console.error(err)
  }

});

// Show details for page
app.get('/details/:fileId', async function(req, res) {
  let connection;
  let result;

  try {
      connection = await pool.getConnection();
      result = await pool.query("SELECT * FROM files WHERE id = ?", req.params.fileId);


  } catch(e) {
      console.log("ERROR: " +e);
      throw e;
  } finally {
      // Check if the user has it upvoted or downvoted
      connection.release();
      var upvoted = false;
      var downvoted = false;
      // Check if upvoted to make color of text change
      if (req.isAuthenticated()) {
        await req.user.then(function(resultN) {
          userName = resultN.name;
        });

        downNames = JSON.parse(result[0][0].down)
        upNames = JSON.parse(result[0][0].up)
        for (var i = 0; i < upNames.length; i++) {
          if (upNames[i] == userName) {
            upvoted = true;
            break;
          }
        }
        for (var i = 0; i < downNames.length; i++) {
          if (downNames[i] == userName) {
            downvoted = true;
            break;
          }
        }
    }
      res.render('details', { logged: req.isAuthenticated(), upvoted: upvoted, downvoted : downvoted, votes: JSON.parse(result[0][0].up).length - JSON.parse(result[0][0].down).length, comments: JSON.parse(result[0][0].comments), id: req.params.fileId, file: result[0][0].dbname, subjects: result[0][0].subject, thumbnail: result[0][0].thumbnail, fileName: result[0][0].name, uploader: result[0][0].uploader, fileDescription: result[0][0].description})
      res.end();
  }
});

// Upvote or downvote or comment
app.post('/details/:fileId', checkAuthenticated, async function(req, res) {
  let connection;
  let before;
  let after = [];
  let userName;
  if (req.body.comment == null) {
    // Check if they clicked upvote or downvote
    try {
        await req.user.then(function(resultN) {
          userName = resultN.name;
        });
        connection = await pool.getConnection();
        before = await pool.query("SELECT * FROM files WHERE id = ?", req.params.fileId);
        upNames = JSON.parse(before[0][0].up)
        downNames = JSON.parse(before[0][0].down)
        if (req.body.vote == "up") {
          for (var i = 0; i < upNames.length; i++) {
            if (upNames[i] == userName) {
              upNames.splice(i, 1);
              let result = await pool.query("UPDATE files SET up = ? WHERE id = ?", [JSON.stringify(upNames), req.params.fileId]);
              return;
            }
          }
          for (var i = 0; i < downNames.length; i++) {
            if (downNames[i] == userName) {
              downNames.splice(i, 1);
              let result = await pool.query("UPDATE files SET down = ? WHERE id = ?", [JSON.stringify(downNames), req.params.fileId]);
            }
          }
          upNames.push(userName);
          let result = await pool.query("UPDATE files SET up = ? WHERE id = ?", [JSON.stringify(upNames), req.params.fileId]);
        }

        if (req.body.vote == "down") {
          for (var i = 0; i < downNames.length; i++) {
            if (downNames[i] == userName) {
              downNames.splice(i, 1);
              let result = await pool.query("UPDATE files SET down = ? WHERE id = ?", [JSON.stringify(downNames), req.params.fileId]);
              return;
            }
          }
          for (var i = 0; i < upNames.length; i++) {
            if (upNames[i] == userName) {
              upNames.splice(i, 1);
              let result = await pool.query("UPDATE files SET up = ? WHERE id = ?", [JSON.stringify(upNames), req.params.fileId]);
            }
          }
          downNames.push(userName);
          let result = await pool.query("UPDATE files SET down = ? WHERE id = ?", [JSON.stringify(downNames), req.params.fileId]);
        }
    } catch(e) {
        console.log("ERROR: " +e);
        throw e;
    } finally {
        connection.release();
        res.redirect(req.params.fileId);
        res.end();
    }
  }
  // Check if user commented
  else {
    await req.user.then(function(resultN) {
      after = [[resultN.name, req.body.comment]];
    });
    try {
        connection = await pool.getConnection();
        before = await pool.query("SELECT comments FROM files WHERE id = ?", req.params.fileId);
        before = JSON.parse(before[0][0].comments);
        after = after.concat(before);
        after = JSON.stringify(after);
        result = await pool.query("UPDATE files SET comments = ? WHERE id = ?", [after, req.params.fileId]);
    } catch(e) {
        console.log("ERROR: " +e);
        throw e;
    } finally {
        connection.release();
        res.redirect(req.params.fileId);
        res.end();
    }
  }
});

// Renders about page
app.get('/about', function(req,res){
    res.render('about', { logged: true });
});

// Imports search and explore functions
require('./searchexplore.js')(app, pool, cloudinary);


var port = process.env.PORT;

// For local testing
/*
app.listen(port,function(){
    console.log("Working on port " + port);
});
*/

// For production with SSL
var privateKey = fs.readFileSync( 'private.key.pem' );
var certificate = fs.readFileSync( 'domain.cert.pem' );

https.createServer({
    key: privateKey,
    cert: certificate
}, app).listen(port);

http.createServer(function (req, res) {
    res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
    res.end();
}).listen(80);
