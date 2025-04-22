const verifyApiKey = (req, res, next) => {
    const apiKey = req.header('X-API-Key');
    console.log(apiKey);
    if (!apiKey) {
        return res.status(401).json({ 
            success: false, 
            message: 'API Key is missing' 
        });
    }

    if (apiKey !== process.env.API_KEY) {
        return res.status(403).json({ 
            success: false, 
            message: 'Invalid API Key' 
        });
    }

    next();
};

module.exports = verifyApiKey; 