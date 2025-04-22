require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const VendorInventory = require('./models/VendorInventory');
const verifyApiKey = require('./middleware/auth');

const app = express();
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => {
    console.log('✅ Portal Server successfully connected to MongoDB');
})
.catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
});

const POS_SERVER_URL = process.env.POS_SERVER_URL || 'http://localhost:3000';

// Apply API Key verification to all sync routes
app.use('/api/sync', verifyApiKey);
app.use('/api/inventory', verifyApiKey);
app.use('/api/portal', verifyApiKey);

// 1. Stock Refill Sync
app.post('/api/sync/refill', async (req, res) => {
    try {
        console.log("called refill")
        const { productId, vendorId, quantity, timestamp } = req.body;
        
        const inventory = await VendorInventory.findOne({ productId, vendorId });
        const previousQuantity = inventory ? inventory.quantityAvailable : 0;

        const updatedInventory = await VendorInventory.findOneAndUpdate(
            { productId, vendorId },
            {
                $inc: { quantityAvailable: quantity },
                $set: { lastSync: timestamp },
                $push: {
                    syncHistory: {
                        timestamp,
                        action: 'refill',
                        quantity,
                        previousQuantity
                    }
                }
            },
            { upsert: true, new: true }
        );

        res.json({ success: true, inventory: updatedInventory });
    } catch (error) {
        console.error('Refill sync error:', error);
        res.status(500).json({ error: 'Failed to sync refill' });
    }
});

// 2. Audit Sync
app.post('/api/sync/audit', async (req, res) => {
    try {
        const { productId, vendorId, newQuantity, reason, timestamp } = req.body;
        
        const inventory = await VendorInventory.findOne({ productId, vendorId });
        const oldQuantity = inventory ? inventory.quantityAvailable : 0;

        const updatedInventory = await VendorInventory.findOneAndUpdate(
            { productId, vendorId },
            {
                $set: { 
                    quantityAvailable: newQuantity,
                    lastSync: timestamp
                },
                $push: {
                    auditHistory: {
                        timestamp,
                        oldQuantity,
                        newQuantity,
                        reason
                    },
                    syncHistory: {
                        timestamp,
                        action: 'audit',
                        quantity: newQuantity - oldQuantity,
                        previousQuantity: oldQuantity
                    }
                }
            },
            { upsert: true, new: true }
        );

        res.json({ success: true, inventory: updatedInventory });
    } catch (error) {
        console.error('Audit sync error:', error);
        res.status(500).json({ error: 'Failed to sync audit' });
    }
});

// 3. Sales Sync
app.post('/api/sync/sale', async (req, res) => {
    try {
        const { productId, vendorId, quantity, timestamp } = req.body;
        
        const inventory = await VendorInventory.findOne({ productId, vendorId });
        
        if (!inventory || inventory.quantityAvailable < quantity) {
            return res.status(400).json({ error: 'Insufficient stock' });
        }

        const updatedInventory = await VendorInventory.findOneAndUpdate(
            { 
                productId, 
                vendorId,
                quantityAvailable: { $gte: quantity }
            },
            {
                $inc: { quantityAvailable: -quantity },
                $set: { lastSync: timestamp },
                $push: {
                    syncHistory: {
                        timestamp,
                        action: 'sale',
                        quantity: -quantity,
                        previousQuantity: inventory.quantityAvailable
                    }
                }
            },
            { new: true }
        );

        res.json({ success: true, inventory: updatedInventory });
    } catch (error) {
        console.error('Sale sync error:', error);
        res.status(500).json({ error: 'Failed to sync sale' });
    }
});

// Get current inventory for a product across all vendors
app.get('/api/inventory/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const inventories = await VendorInventory.find({ 
            productId,
            quantityAvailable: { $gt: 0 }
        });
        
        res.json({ inventories });
    } catch (error) {
        console.error('Inventory fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch inventory' });
    }
});

// PURCHASE OF AN ORDER FROM CUSTOMER APP
app.post('/api/portal/purchaseproduct', async (req, res) => {
    try {
        console.log("called posserver in purchased product")
        const { productId, vendorId, quantity } = req.body;
        const apiKey = req.header('X-API-Key'); // Get the API key from the request header
        console.log(apiKey+" "+"in purchase product")

        // 1. Check inventory in portal first
        const inventory = await VendorInventory.findOne({ productId, vendorId });
        if (!inventory || inventory.quantityAvailable < quantity) {
            return res.status(400).json({ 
                error: 'Insufficient stock',
                currentStock: inventory ? inventory.quantityAvailable : 0
            });
        }

        // 2. Generate Order ID
        const orderId = 'ORD' + Date.now() + Math.floor(Math.random() * 1000);

        // 3. Sync with POS Server first - Forward the same API key
        try {
            const posResponse = await axios.post(`${POS_SERVER_URL}/api/pos/sync`, {
                productId,
                vendorId,
                quantity,
                orderId
            }, {
                headers: {
                    'X-API-Key': 'pos_server_api_key_here' // Forward the same API key
                }
            });

            if (!posResponse.data.success) {
                throw new Error('POS sync failed');
            }
        } catch (syncError) {
            console.error('POS sync error:', syncError);
            return res.status(500).json({ 
                error: 'Failed to sync with POS system',
                details: syncError.response?.data || syncError.message
            });
        }

        // 4. Update portal inventory
        const updatedInventory = await VendorInventory.findOneAndUpdate(
            { 
                productId, 
                vendorId,
                quantityAvailable: { $gte: quantity }
            },
            {
                $inc: { quantityAvailable: -quantity },
                $set: { lastSync: new Date() },
                $push: {
                    syncHistory: {
                        timestamp: new Date(),
                        action: 'purchase',
                        quantity: -quantity,
                        previousQuantity: inventory.quantityAvailable,
                        orderId
                    }
                }
            },
            { new: true }
        );

        // 5. Return success response
        res.json({
            success: true,
            orderId,
            inventory: updatedInventory,
            message: 'Purchase successful'
        });

    } catch (error) {
        console.error('Purchase error:', error);
        res.status(500).json({ 
            error: 'Failed to process purchase',
            details: error.message
        });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Portal Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
}); 