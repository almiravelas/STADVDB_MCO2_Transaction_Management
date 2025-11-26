// controller.js
const express = require('express');
const router = express.Router();
const db_service = require('./models/db_service');

// ============================================
// RENDER MAIN PAGE
// ============================================
router.get('/', (req, res) => {
    res.render('index');
});

// ============================================
// CREATE USER
// ============================================
router.post('/api/users', async (req, res) => {
    try {
        const userData = req.body;
        const result = await db_service.createUser(userData);
        res.status(201).json(result);
    } catch (error) {
        console.error('Create User Error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// ============================================
// GET USER BY ID (Central Node)
// ============================================
router.get('/api/users/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await db_service.getUserById(userId);
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        
        res.json(user);
    } catch (error) {
        console.error('Get User Error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// ============================================
// GET USERS BY COUNTRY (Partition Node)
// ============================================
router.get('/api/users/country/:country', async (req, res) => {
    try {
        const country = req.params.country;
        const users = await db_service.getUsersByCountry(country);
        res.json(users);
    } catch (error) {
        console.error('Get Users by Country Error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// ============================================
// UPDATE USER
// ============================================
router.put('/api/users/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const updateData = req.body;
        const result = await db_service.updateUser(userId, updateData);
        res.json(result);
    } catch (error) {
        console.error('Update User Error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// ============================================
// DELETE USER
// ============================================
router.delete('/api/users/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const result = await db_service.deleteUser(userId);
        res.json(result);
    } catch (error) {
        console.error('Delete User Error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// ============================================
// GET STATISTICS (Optional - For Dashboard)
// ============================================
router.get('/api/stats', async (req, res) => {
    try {
        // You can implement this to get counts from each node
        // For now, returning placeholder
        const stats = {
            totalUsers: 0,
            node1Count: 0,
            node2Count: 0
        };
        
        res.json(stats);
    } catch (error) {
        console.error('Get Stats Error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

module.exports = router;