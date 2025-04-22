const mongoose = require('mongoose');

const vendorInventorySchema = new mongoose.Schema({
    productId: {
        type: String,
        required: true,
        index: true
    },
    vendorId: {
        type: String,
        required: true,
        index: true
    },
    quantityAvailable: {
        type: Number,
        default: 0
    },
    lastSync: {
        type: Date,
        default: Date.now
    },
    auditHistory: [{
        timestamp: Date,
        oldQuantity: Number,
        newQuantity: Number,
        reason: String
    }],
    syncHistory: [{
        timestamp: Date,
        action: String,
        quantity: Number,
        previousQuantity: Number
    }]
}, { timestamps: true });

// Compound index for faster lookups
vendorInventorySchema.index({ productId: 1, vendorId: 1 }, { unique: true });

module.exports = mongoose.model('VendorInventory', vendorInventorySchema); 