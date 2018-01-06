'use strict';

const functions = require('firebase-functions'); // Cloud Functions for Firebase library
const DialogflowApp = require('actions-on-google').DialogflowApp; // Google Assistant helper library
const admin = require('firebase-admin');
const request_api = require('request');
const axios = require('axios');
const ActiveCollabUrl = 'http://ac.bounche.com/api/v1/';
const LoginUrl = 'https://achelper-f04aa.firebaseapp.com';
const UserCollection = '/users/';
const TaskUrl = '';
const botbuilder = require('botbuilder')

// CORS Express middleware to enable CORS Requests.
const cors = require('cors')({origin: true});

const googleAssistantRequest = 'google'; // Constant to identify Google Assistant requests
admin.initializeApp(functions.config().firebase);

exports.login = functions.https.onRequest((request, response) => {
    cors(request, response, () => {
        console.log('Request body: ' + JSON.stringify(request.body));
        const { skype, verifyToken, email, password } = request.body;
        const getUserPromise = admin.database().ref(UserCollection + skype).once('value').then( snapshot => {
            const userObject = snapshot.val();
            if (userObject === null || userObject.verifyToken !== verifyToken){
                throw new Error("Not Found")
            }
            axios.post(ActiveCollabUrl+'issue-token', {
                username: email,
                password: password,
                client_name: "AC Helper Skype",
                client_vendor: "Bounche Indonesia"
            })
            .then( response => {
                const data = response.data;
                admin.database().ref(UserCollection + skype).update({
                    verifyToken: null,
                    ACToken: data.token,
                    ACEmail: email,
                });
                response.status(200).json(response);
            })
            .catch( error => {
                response.status(500).json(error);
            });
        }).catch( error => {
            console.log(error);
            response.status(400).json({ error: error.message });
        });
    });
});


// exports.login = functions.https.onRequest((req, res) => {
//     // ...
// });
exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
    console.log('Request headers: ' + JSON.stringify(request.headers));
    console.log('Request body: ' + JSON.stringify(request.body));

    // An action is a string used to identify what needs to be done in fulfillment
    let action = request.body.result.action; // https://dialogflow.com/docs/actions-and-parameters

    // Parameters are any entites that Dialogflow has extracted from the request.
    const parameters = request.body.result.parameters; // https://dialogflow.com/docs/actions-and-parameters

    // Contexts are objects used to track and store conversation state
    const inputContexts = request.body.result.contexts; // https://dialogflow.com/docs/contexts

    // Get the request source (Google Assistant, Slack, API, etc) and initialize DialogflowApp
    const requestSource = (request.body.originalRequest) ? request.body.originalRequest.source : undefined;
    const app = new DialogflowApp({request: request, response: response});

    const userData = request.body.originalRequest.data.address.user;
    console.log('user data: '+ JSON.stringify(userData));
    // Create handlers for Dialogflow actions as well as a 'default' handler
    const actionHandlers = {
        // The default welcome intent has been matched, welcome the user (https://dialogflow.com/docs/events#default_welcome_intent)
        'input.welcome': () => {
        // Use the Actions on Google lib to respond to Google requests; for other requests use JSON
        if (requestSource === googleAssistantRequest) {
            sendGoogleResponse('Hello, Welcome to my Dialogflow agent!'); // Send simple response to user
        } else {
            let message;
              // When something is added, make the ajax call
                request_api(ActiveCollabUrl+'/info', function (error, response, body) {
                    if (!error && response.statusCode == 200) {
                        body = JSON.parse(body);
                        // message = "Hello, "+ userData.name +" "+ body.application + " version: " + body.version;
                        message = "Hello, " + userData.name;
                        message +=  "<br/> What do you want me to do? <br/> 1. View Project <br/> 2. View Task <br/> 3. View All Member <br/> 4. Add Task <br/> 5. Delete Task <br/> 6. Add Time Record";
                        sendResponse(message); // Send simple response to user
                    }else{
                        message = "error bang";
                        console.log('error: '+ error);
                        sendResponse(message); // Send simple response to user
                    }
                });
            }
        },
        // The default fallback intent has been matched, try to recover (https://dialogflow.com/docs/intents#fallback_intents)
        'input.unknown': () => {
            // Use the Actions on Google lib to respond to Google requests; for other requests use JSON
            if (requestSource === googleAssistantRequest) {
                sendGoogleResponse('I\'m having trouble, can you try that again?'); // Send simple response to user
            } else {
                sendResponse('Salah Ketik Mas, Ga ngerti gw!'); // Send simple response to user
            }
        },
        // The Login intent has been matched
        'user.login': () => {
            // Get user Status.
            console.log(UserCollection + userData.id);
            const getUserPromise = admin.database().ref(UserCollection + userData.id).once('value');

            return Promise.all([getUserPromise]).then(results => {
                const userSnapshot = results[0];
                const userObject = userSnapshot.val();
                if (userObject === null || !userSnapshot.hasChild('ACToken')){
                    const verificationToken = randomStringAsBase64Url(12);
                    admin.database().ref(UserCollection + userData.id).set({
                        username: userData.name,
                        verifyToken: verificationToken,
                        ACToken: null,
                        ACEmail: null
                    });
                    let responseToUser = "Please Signin on this Link "+LoginUrl+"/?token="+verificationToken;
                    console.log('response: ' + responseToUser);
                    sendResponse(responseToUser);
                }else{
                    let responseToUser = "You have already signin";
                    console.log('response: ' + responseToUser);
                    sendResponse(responseToUser);
                }
            });
        },
        'user.view.project': () => {
            const getUserPromise = admin.database().ref(UserCollection + userData.id).once('value');
            return Promise.all([getUserPromise]).then(results => {
                const userSnapshot = results[0];
                const userObject = userSnapshot.val();
                if (userObject === null || !userSnapshot.hasChild('ACToken') || !userSnapshot.hasChild('ACEmail')){
                    let responseToUser = "Please Signin First";
                    sendResponse(responseToUser);
                }else{
                    let ACUserID;
                    const axiosConfig = {
                        headers: {'X-Angie-AuthApiToken': userObject.ACToken}
                    };
                    //Get User Session == User ID
                    axios.get(ActiveCollabUrl+'user-session',axiosConfig)
                        .then( ac_response => {
                            ACUserID = ac_response.data.logged_user_id;
                            if (ACUserID === 0){
                                throw new Error('Not Authorize');
                            }
                            axios.get(ActiveCollabUrl+'users/'+ACUserID+'/projects',axiosConfig)
                                .then( task_response => {
                                    //Send Task List
                                    let responseToUser = "Project list: <br/>";
                                    console.log(JSON.stringify(task_response.data));
                                    task_response.data.forEach((result, index) => {
                                        responseToUser += (index+1) + " " + result.name + "<br/>"
                                    });
                                    responseToUser += "What do you want me to do next? <br/> 1. Add Project <br/> 2. Delete Project <br/> 3. View Task <br/> 4. Add Task <br/> 5. Add Time Record";
                                    console.log('response: ' + responseToUser);
                                    sendResponse(responseToUser);
                                }).catch( error => {
                                    console.log("project Error: "+error);
                                    throw new Error('Error View Project')
                                });
                        })
                        .catch( error => {
                            console.log(error);
                            let responseToUser = "Not Sign In";
                            sendResponse(responseToUser);
                        });
                }
            });
        },
        'user.task.list': () => {
            const getUserPromise = admin.database().ref(UserCollection + userData.id).once('value');
            return Promise.all([getUserPromise]).then(results => {
                const userSnapshot = results[0];
                const userObject = userSnapshot.val();
                if (userObject === null || !userSnapshot.hasChild('ACToken') || !userSnapshot.hasChild('ACEmail')){
                    let responseToUser = "Please Signin First";
                    sendResponse(responseToUser);
                }else{
                    let ACUserID;
                    const axiosConfig = {
                        headers: {'X-Angie-AuthApiToken': userObject.ACToken}
                    };
                    //Get User Session == User ID
                    axios.get(ActiveCollabUrl+'user-session',axiosConfig)
                        .then( ac_response => {
                            ACUserID = ac_response.data.logged_user_id;
                            if (ACUserID === 0){
                                throw new Error('Not Authorize');
                            }
                            axios.get(ActiveCollabUrl+'users/'+ACUserID+'/tasks',axiosConfig)
                                .then( task_response => {
                                    //Send Task List
                                    let responseToUser = "Task List: <br/>";
                                    console.log(JSON.stringify(task_response.data));
                                    task_response.data.tasks.forEach((result, index) => {
                                        responseToUser += (index+1) + " " + result.name + "<br/>"
                                    });

                                    responseToUser += "What do you want me to do next? <br/> 1. Add Task <br/> 2. Delete Task <br/> 3. View Project <br/> 4. Add Project <br/> 5. Add Time Record";
                                    console.log('response: ' + responseToUser);
                                    sendResponse(responseToUser);
                                }).catch( error => {
                                    console.log("task Error: "+error);
                                    throw new Error('Error Task List')
                                });
                        })
                        .catch( error => {
                            console.log(error);
                            let responseToUser = "Not Sign In";
                            sendResponse(responseToUser);
                        });
                }
            });
        },

        'user.view.member': () => {
            console.log("masuk ke sini ga?");
            const getUserPromise = admin.database().ref(UserCollection + userData.id).once('value');
            return Promise.all([getUserPromise]).then(results => {
                const userSnapshot = results[0];
                const userObject = userSnapshot.val();
                if (userObject === null || !userSnapshot.hasChild('ACToken') || !userSnapshot.hasChild('ACEmail')){
                    let responseToUser = "Please Signin First";
                    sendResponse(responseToUser);
                }else{
                    let ACUserID;
                    const axiosConfig = {
                        headers: {'X-Angie-AuthApiToken': userObject.ACToken}
                    };
                    //Get User Session == User ID
                    axios.get(ActiveCollabUrl+'user-session',axiosConfig)
                        .then( ac_response => {
                            ACUserID = ac_response.data.logged_user_id;
                            if (ACUserID === 0){
                                throw new Error('Not Authorize');
                            }
                            axios.get(ActiveCollabUrl+'users',axiosConfig)
                                .then( task_response => {
                                    console.log("masuk kesini");
                                    //Send Task List
                                    let responseToUser = "Member in AC: <br/>";
                                    console.log(JSON.stringify(task_response.data));
                                    task_response.data.forEach((result, index) => {
                                        responseToUser += (index+1) + " " + result.display_name + "<br/>"
                                    });
                                    responseToUser += "What do you want me to do next? <br/> 1. View Project <br/> 2. View Task <br/> 3. Add Time Record";
                                    console.log('response view member: ' + responseToUser);
                                    sendResponse(responseToUser);
                                }).catch( error => {
                                    console.log("view member error: "+error);
                                    throw new Error('Error View Member')
                                });
                        })
                        .catch( error => {
                            console.log(error);
                            let responseToUser = "Not Sign In";
                            sendResponse(responseToUser);
                        });
                }
            });
        },

        // Default handler for unknown or undefined actions
        'default': () => {
            // Use the Actions on Google lib to respond to Google requests; for other requests use JSON
            if (requestSource === googleAssistantRequest) {
                let responseToUser = {
                    //googleRichResponse: googleRichResponse, // Optional, uncomment to enable
                    //googleOutputContexts: ['weather', 2, { ['city']: 'rome' }], // Optional, uncomment to enable
                    speech: 'This message is from Dialogflow\'s Cloud Functions for Firebase editor!', // spoken response
                    displayText: 'This is from Dialogflow\'s Cloud Functions for Firebase editor! :-)' // displayed response
                };
                sendGoogleResponse(responseToUser);
            } else {
                let responseToUser = {
                    //richResponses: richResponses, // Optional, uncomment to enable
                    //outputContexts: [{'name': 'weather', 'lifespan': 2, 'parameters': {'city': 'Rome'}}], // Optional, uncomment to enable
                    speech: 'This message is from Dialogflow\'s Cloud Functions for Firebase editor!', // spoken response
                    displayText: 'This is from Dialogflow\'s Cloud Functions for Firebase editor! :-)' // displayed response
                };
                sendResponse(responseToUser);
            }
        }
    };

    // If undefined or unknown action use the default handler
    if (!actionHandlers[action]) {
        action = 'default';
    }

    // Run the proper handler function to handle the request from Dialogflow
    actionHandlers[action]();

    // Function to send correctly formatted Google Assistant responses to Dialogflow which are then sent to the user
    function sendGoogleResponse (responseToUser) {
        if (typeof responseToUser === 'string') {
            app.ask(responseToUser); // Google Assistant response
        } else {
            // If speech or displayText is defined use it to respond
            let googleResponse = app.buildRichResponse().addSimpleResponse({
                speech: responseToUser.speech || responseToUser.displayText,
                displayText: responseToUser.displayText || responseToUser.speech
            });

            // Optional: Overwrite previous response with rich response
            if (responseToUser.googleRichResponse) {
                googleResponse = responseToUser.googleRichResponse;
            }

            // Optional: add contexts (https://dialogflow.com/docs/contexts)
            if (responseToUser.googleOutputContexts) {
                app.setContext(...responseToUser.googleOutputContexts);
            }

            app.ask(googleResponse); // Send response to Dialogflow and Google Assistant
        }
    }

    // Function to send correctly formatted responses to Dialogflow which are then sent to the user
    function sendResponse (responseToUser) {
        // if the response is a string send it as a response to the user
        if (typeof responseToUser === 'string') {
            let responseJson = {};
            responseJson.speech = responseToUser; // spoken response
            responseJson.displayText = responseToUser; // displayed response
            response.json(responseJson); // Send response to Dialogflow
        } else {
            // If the response to the user includes rich responses or contexts send them to Dialogflow
            let responseJson = {};
            // let responseJson = {
            //     "buttons": [
            //         {
            //             "postback": "Card Link URL or text",
            //             "text": "Card Link Title"
            //         }
            //     ],
            //     "imageUrl": "http://urltoimage.com",
            //     "platform": "skype",
            //     "subtitle": "Card Subtitle",
            //     "title": "Card Title",
            //     "type": 1
            // };
            //
            // If speech or displayText is defined, use it to respond (if one isn't defined use the other's value)
            responseJson.speech = responseToUser.speech || responseToUser.displayText;
            responseJson.displayText = responseToUser.displayText || responseToUser.speech;

            // Optional: add rich messages for integrations (https://dialogflow.com/docs/rich-messages)
            responseJson.data = responseToUser.richResponses;

            // Optional: add contexts (https://dialogflow.com/docs/contexts)
            responseJson.contextOut = responseToUser.outputContexts;

            response.json(responseJson); // Send response to Dialogflow
        }
    }
    //Random String Generator
    function randomStringAsBase64Url(length) {
        let text = "";
        let possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for(let i = 0; i < length; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
});

// Construct rich response for Google Assistant
const app = new DialogflowApp();
const googleRichResponse = app.buildRichResponse()
    .addSimpleResponse('This is the first simple response for Google Assistant')
    .addSuggestions(
        ['Suggestion Chip', 'Another Suggestion Chip'])
    // Create a basic card and add it to the rich response
    .addBasicCard(app.buildBasicCard(`This is a basic card.  Text in a
 basic card can include "quotes" and most other unicode characters
 including emoji 📱.  Basic cards also support some markdown
 formatting like *emphasis* or _italics_, **strong** or __bold__,
 and ***bold itallic*** or ___strong emphasis___ as well as other things
 like line  \nbreaks`) // Note the two spaces before '\n' required for a
    // line break to be rendered in the card
        .setSubtitle('This is a subtitle')
        .setTitle('Title: this is a title')
        .addButton('This is a button', 'https://assistant.google.com/')
        .setImage('https://developers.google.com/actions/images/badges/XPM_BADGING_GoogleAssistant_VER.png',
            'Image alternate text'))
    .addSimpleResponse({ speech: 'This is another simple response',
        displayText: 'This is the another simple response 💁' });

// Rich responses for both Slack and Facebook
const richResponses = {
    'slack': {
        'text': 'This is a text response for Slack.',
        'attachments': [
            {
                'title': 'Title: this is a title',
                'title_link': 'https://assistant.google.com/',
                'text': 'This is an attachment.  Text in attachments can include \'quotes\' and most other unicode characters including emoji 📱.  Attachments also upport line\nbreaks.',
                'image_url': 'https://developers.google.com/actions/images/badges/XPM_BADGING_GoogleAssistant_VER.png',
                'fallback': 'This is a fallback.'
            }
        ]
    },
    'skype': {
        "type": "message",
        "text": "Sample with a thumbnail card",
        "attachments": [
          {
            "contentType": "application/vnd.microsoft.card.thumbnail",
            "content": {
              "title": "I'm a thumbnail card",
              "subtitle": "Please visit my site.",
              "images": [
                {
                  "url": "https://mydeploy.azurewebsites.net/matsu.jpg"
                }
              ],
              "buttons": [
                {
                  "type": "openUrl",
                  "title": "Go to my site",
                  "value": "https://blogs.msdn.microsoft.com/tsmatsuz"
                }
              ]
            }
          }
        ]
    },
    'facebook': {
        'attachment': {
            'type': 'template',
            'payload': {
                'template_type': 'generic',
                'elements': [
                    {
                        'title': 'Title: this is a title',
                        'image_url': 'https://developers.google.com/actions/images/badges/XPM_BADGING_GoogleAssistant_VER.png',
                        'subtitle': 'This is a subtitle',
                        'default_action': {
                            'type': 'web_url',
                            'url': 'https://assistant.google.com/'
                        },
                        'buttons': [
                            {
                                'type': 'web_url',
                                'url': 'https://assistant.google.com/',
                                'title': 'This is a button'
                            }
                        ]
                    }
                ]
            }
        }
    }
};

