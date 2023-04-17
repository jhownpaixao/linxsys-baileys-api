const express = require('express');
const MainController = require('../controller/MainController');

const router = express.Router();

/* Session */
router.post('/create-session', MainController.SessionAdd);
router.post('/:session/start-session', MainController.SessionStart);
router.get('/:session/check-connection-session', MainController.SessionStatus);
router.get('/:session/validate-number/:number', MainController.ValidateNumber);
router.get('/:session/disconnect', MainController.SessionDesconnect);
router.get('/:session/delete', MainController.SessionDelete);

/* Message */
router.post('/:session/message/send-text', MainController.SendText);
router.post('/:session/message/send-image', MainController.SendImage);

module.exports = router;
