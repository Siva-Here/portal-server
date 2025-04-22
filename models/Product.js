const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    productId: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    description: String,
    category: String,
    price: {
        type: Number,
        required: true
    },
    unit: {
        type: String,
        default: 'piece'
    },
    minStockLevel: {
        type: Number,
        default: 10
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema); 