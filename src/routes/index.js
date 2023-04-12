const express = require('express')
const MainController = require('../controller/MainController');

const router = express.Router();


router.post('/create-session', MainController.SessionAdd)

router.post('/:session/start-session', MainController.SessionStart)
router.post('/:session/send-text', MainController.SendText)
router.get('/:session/check-connection-session', MainController.SessionStatus)
router.get('/:session/validate-number/:number', MainController.ValidateNumber)

module.exports = router;