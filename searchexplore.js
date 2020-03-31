module.exports = function (app, pool, cloudinary) {
  app.get('/search/', async function(req,res){
      let connection;
      var requestq = req.query.search
      var userlook = false;
      if (req.query.look == "user") {
        userlook = true;
      }
      if (requestq == "") {
        return res.render('search', {empty: true, userlook: userlook})
      }
      requestq = requestq.toLowerCase();

      try {
          // Try using the mysql search function
          connection = await pool.getConnection();
          if (userlook) searchRes = await pool.query("SELECT * FROM users WHERE MATCH (name) AGAINST (? WITH QUERY EXPANSION)", requestq);
          else searchRes = await pool.query("SELECT * FROM files WHERE MATCH (keywords) AGAINST (? WITH QUERY EXPANSION)", requestq);
      } catch(e) {
          // log the error and the rethrow so the caller gets it
          console.log(e);
          throw e;
      } finally {
            connection.release();
      }
      if (searchRes[0].length === 0) {
        try {
            // If it doesn't work, just see if any have the whole String in the keywords
            connection = await pool.getConnection();
            requestq = "%" + requestq + "%"
            // User lookup - only sees them that are exactly the same
            if (userlook) await pool.query("SELECT * FROM users WHERE name LIKE ?", requestq);
            else searchRes = await pool.query("SELECT * FROM files WHERE keywords LIKE ?", requestq);
        } catch(e) {
            // log the error and the rethrow so the caller gets it
            console.log(e);
            throw e;
        } finally {
              connection.release();
        }
        if (searchRes[0].length === 0) {
          return res.render('search', {empty: true, userlook : userlook, searchquery: req.query.search})
        }
      }
      if (userlook) {
        var names = [];
        for (var i = 0; i < searchRes[0].length; i++) {
          names.push(searchRes[0][i].name)
        }
        res.render('search', { searchquery: req.query.search, empty : false, names : names, userlook: userlook})
        res.end();
      }
      else {
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
        for (var i = 0; i < searchRes[0].length; i++) {
          files.push(searchRes[0][i].dbname)
          thumbnails.push(searchRes[0][i].thumbnail);
          fileNames.push(searchRes[0][i].name);
          descriptions.push(searchRes[0][i].description);
          uploaders.push(searchRes[0][i].uploader);
          fileIds.push(searchRes[0][i].id);
          subjects.push(searchRes[0][i].subject);
          votes.push(JSON.parse(searchRes[0][i].up).length - JSON.parse(searchRes[0][0].down).length);
          comments.push(JSON.parse(searchRes[0][i].comments).length);
        }
        res.render('search', { userlook: userlook, searchquery: req.query.search, comments: comments, votes: votes, empty : false, logged: req.isAuthenticated(), subjects: subjects, thumbnails: thumbnails, files: files, uploaders: uploaders, descriptions: descriptions, fileNames : fileNames, fileIds : fileIds })
        res.end();
      }
  });

  app.get('/explore', async function(req,res){
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
    let connection;
    try {
        connection = await pool.getConnection();
        let sqlres = await pool.query("SELECT * FROM files");
        let numtoDo = 0;
        // Only shows first 10 files - maybe fix later
        if (sqlres[0].length < 10) {
          numtoDo = sqlres[0].length;
        }
        else {
          numtoDo = 10;
        }
        for (var i = 0; i < numtoDo; i++) {
          files.push(sqlres[0][i].dbname);
          thumbnails.push(sqlres[0][i].thumbnail);
          fileNames.push(sqlres[0][i].name);
          descriptions.push(sqlres[0][i].description);
          uploaders.push(sqlres[0][i].uploader);
          fileIds.push(sqlres[0][i].id);
          subjects.push(sqlres[0][i].subject);
          votes.push(JSON.parse(sqlres[0][i].up).length - JSON.parse(sqlres[0][i].down).length);
          comments.push(JSON.parse(sqlres[0][i].comments).length);
        }
    } catch(e) {
        console.log(e);
        throw e;
    } finally {
        connection.release();
        res.render('explore', { votes: votes, comments: comments, logged: req.isAuthenticated(), subjects: subjects, thumbnails: thumbnails, files: files, uploaders: uploaders, descriptions: descriptions, fileNames : fileNames, fileIds : fileIds })
        res.end();
    }
  });

}
