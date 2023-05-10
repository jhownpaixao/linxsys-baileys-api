const express = require('express');
const MainController = require('../controller/MainController');
const router = express.Router();

/* Session */
router.post('/create-session', MainController.SessionAdd);
router.post('/:session/start-session', MainController.ValidateToken, MainController.SessionStart);
router.get('/:session/check-connection-session', MainController.ValidateToken, MainController.SessionStatus);
router.get('/:session/validate-number/:number', MainController.ValidateToken, MainController.ValidateNumber);
router.get('/:session/disconnect', MainController.ValidateToken, MainController.SessionDesconnect);
router.get('/:session/delete', MainController.ValidateToken, MainController.SessionDelete);

/* Message */
router.post('/:session/message/send-text', MainController.ValidateToken, MainController.SendText);
router.post('/:session/message/send-image', MainController.ValidateToken, MainController.upload.single('image'), MainController.SendImage);
router.post('/:session/message/send-audio', MainController.ValidateToken, MainController.upload.single('audio'), MainController.SendAudio);
module.exports = router;
