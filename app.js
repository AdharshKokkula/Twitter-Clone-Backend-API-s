const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()
app.use(express.json())

const dbpath = path.join(__dirname, 'twitterClone.db')
let database = null

const initializeDatabaseAndServer = async () => {
  try {
    database = await open({
      filename: dbpath,
      driver: sqlite3.Database,
    })

    app.listen(3000, () => {
      console.log('\nServer is Running at: http://localhost:3000\n')
    })
  } catch (error) {
    console.log(error)
  }
}

initializeDatabaseAndServer()

//MIDDLEWARE FUNCTION TO AUTHENTICATE
const authenticate = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'secrate', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        // console.log(payload)
        request.username = payload.username
        request.userId = payload.userId
        next()
      }
    })
  }
}

const accessVerification = async (request, response, next) => {
  const {userId} = request
  const {tweetId} = request.params
  const sqlGetQuery = `
    select follower_user_id from 
    follower 
    where ${userId} in (
    select follower_user_id from
    tweet as t inner join follower as f
    on t.user_id = f.following_user_id
    where tweet_id = ${tweetId})`
  const followerList = await database.all(sqlGetQuery)
  if (Object.entries(followerList).length === 0) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

//GETTING DETAILS FROM TABLES FOR CHECKING PURPOSE
app.get('/check/:table', async (request, response) => {
  const {table} = request.params
  const sqlGetQuery = `select * from ${table};`
  const results = await database.all(sqlGetQuery)
  response.send(results)
})

//API 1 USER REGISTRATION
app.post('/register', async (request, response) => {
  const {username, name, password, gender} = request.body
  const sqlGetQuery = `SELECT * FROM user WHERE username = '${username}';`
  const userData = await database.get(sqlGetQuery)
  if (userData === undefined) {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashedPassword = await bcrypt.hash(password, 10)
      const sqlInsertQuery = `INSERT INTO user (name, username, password, gender) VALUES('${name}', '${username}', '${hashedPassword}', '${gender}');`
      await database.run(sqlInsertQuery)
      response.status(200)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

//API 2 USER LOGIN
app.post('/login', async (request, response) => {
  const {username, password} = request.body
  const sqlGetQuery = `SELECT * FROM user WHERE username = '${username}';`
  const userData = await database.get(sqlGetQuery)
  if (userData === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordCorrect = await bcrypt.compare(password, userData.password)
    if (!isPasswordCorrect) {
      response.status(400)
      response.send('Invalid password')
    } else {
      const payLoad = {username: username, userId: userData.user_id}
      // console.log(payLoad)
      const jwtToken = jwt.sign(payLoad, 'secrate')
      response.status(200)
      response.send({jwtToken})
    }
  }
})

//CHANGING USER PASSWORD
app.post('/change-password', authenticate, async (request, response) => {
  const {username} = request
  const sqlGetQuery = `SELECT * FROM user WHERE username = '${username}';`
  const userData = await database.get(sqlGetQuery)
  if (userData === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const {username, oldPassword, newPassword} = request.body
    const sqlGetQuery = `SELECT * FROM user WHERE username = '${username}';`
    const userData = await database.get(sqlGetQuery)
    const isPasswordCorrect = await bcrypt.compare(
      oldPassword,
      userData.password,
    )
    if (!isPasswordCorrect) {
      response.status(400)
      response.send('Invalid current password')
    } else {
      if (newPassword.length < 5) {
        response.status(400)
        response.send('Password is too short')
      } else {
        const hashedPassword = await bcrypt.hash(newPassword, 10)
        const sqlUpdateQuery = `UPDATE user SET password = '${hashedPassword}' WHERE username = '${username}';`
        await database.run(sqlUpdateQuery)
        response.status(200)
        response.send('Password updated')
      }
    }
  }
})

//API 3 USER FEEDS
app.get('/user/tweets/feed/', authenticate, async (request, response) => {
  const {userId} = request
  const sqlGetQuery = `
    select u.username, tweet, date_time as dateTime from 
    tweet as t inner join follower as f
    on f.following_user_id = t.user_id
    inner join user as u
    on t.user_id = u.user_id
    where 
    follower_user_id = ${userId}
    order by date_time desc
    limit 4;`
  const results = await database.all(sqlGetQuery)
  response.send(results)
})

//API 4 FOLLOWING PEOPLE OF THE USER
app.get('/user/following', authenticate, async (request, response) => {
  const {userId} = request
  const sqlGetQuery = `
    select name from 
    user as u inner join follower as f 
    on u.user_id = f.following_user_id 
    where 
    follower_user_id = '${userId}';`
  const results = await database.all(sqlGetQuery)
  response.send(results)
})

//API 5 FOLLOWERS OF THE USER
app.get('/user/followers', authenticate, async (request, response) => {
  const {userId} = request
  const sqlGetQuery = `
    select name from 
    user as u inner join follower as f 
    on u.user_id = follower_user_id 
    where 
    f.following_user_id = '${userId}';`
  const results = await database.all(sqlGetQuery)
  response.send(results)
})

//API 6 GET THE REQUESTED TWEETS
app.get(
  '/tweets/:tweetId',
  authenticate,
  accessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const sqlGetTweetQuery = `
      select tweet, 
      (select count(*) from like where like.tweet_id = t.tweet_id) as likes,
      (select count(*) from reply where reply.tweet_id = t.tweet_id) as replies,
      date_time as dateTime
      from tweet as t where t.tweet_id = '${tweetId}';`
    const tweets = await database.get(sqlGetTweetQuery)
    response.status(200)
    response.send(tweets)
  },
)

//API 7 LIKES FOR REQUESTED TWEETS
app.get(
  '/tweets/:tweetId/likes',
  authenticate,
  accessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const sqlGetTweetQuery = `
      select u.username
      from tweet as t inner join like as l on 
      t.tweet_id = l.tweet_id
      inner join user as u on 
      l.user_id = u.user_id
      where t.tweet_id = ${tweetId};`
    const likedPersonsObject = await database.all(sqlGetTweetQuery)
    const likedPersonsList = likedPersonsObject.map(item => item.username)
    const result = {
      likes: likedPersonsList,
    }
    response.status(200)
    response.send(result)
  },
)

//API 8 REPLIES FOR THE REQUESTED TWEETS
app.get(
  '/tweets/:tweetId/replies',
  authenticate,
  accessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const sqlGetTweetQuery = `
      select u.name, r.reply
      from tweet as t inner join reply as r on 
      t.tweet_id = r.tweet_id 
      inner join user as u on 
      r.user_id = u.user_id
      where t.tweet_id = ${tweetId};`
    const repliedPersonsObject = await database.all(sqlGetTweetQuery)

    const repliedPersonsList = repliedPersonsObject.map(item => ({
      name: item.name,
      reply: item.reply,
    }))
    // console.log(repliedPersonsList)
    const result = {
      replies: repliedPersonsList,
    }
    response.status(200)
    response.send(result)
  },
)

//API 9 GET USER TWEETS
app.get('/user/tweets/', authenticate, async (request, response) => {
  const {userId} = request
  const sqlGetTweetQuery = `
      select tweet, 
      (select count(*) from like where like.tweet_id = t.tweet_id) as likes,
      (select count(*) from reply where reply.tweet_id = t.tweet_id) as replies,
      date_time as dateTime
      from tweet as t where t.user_id = '${userId}';`
  const tweets = await database.all(sqlGetTweetQuery)
  response.status(200)
  response.send(tweets)
})

//API 10 POST TWEETS
app.post('/user/tweets', authenticate, async (request, response) => {
  const {userId} = request
  const {tweet} = request.body
  const sqlInsertQuery = `
  Insert into tweet
  (tweet, user_id)
  values('${tweet}', ${userId});`
  await database.run(sqlInsertQuery)
  response.status(200)
  response.send('Created a Tweet')
})

// API 11 DELETE POST FROM DATABASE
app.delete('/tweets/:tweetId', authenticate, async (request, response) => {
  const {tweetId} = request.params
  const {userId} = request
  const sqlQuery = `
    select * from tweet
    where tweet_id = ${tweetId}
    and user_id = ${userId}`
  const tweetsObj = await database.all(sqlQuery)
  const tweetsList = Object.keys(tweetsObj).length
  if (tweetsList !== 0) {
    const sqlGetQuery = `
      delete from tweet where user_id = ${userId} and tweet_id = ${tweetId};`
    await database.get(sqlGetQuery)
    response.status(200)
    response.send(`Tweet Removed`)
  } else {
    response.status(401)
    response.send('Invalid Request')
  }
})

module.exports = app
