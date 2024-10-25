require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ObjectId } = require('mongodb');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: '*'
}));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Correct Permissions-Policy header
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});

const uri = process.env.MONGODB_URI;
if (!uri) {
    console.error('MONGODB_URI is not defined in the .env file');
    process.exit(1);
}
const client = new MongoClient(uri);

async function connectToDB() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('Failed to connect to MongoDB', err);
        process.exit(1);
    }
}

connectToDB();

// Route handler for the root URL
app.get('/', (req, res) => {
    res.send('Server is running');
});

const userCollection = client.db("test").collection("users");
const storiesCollection = client.db("test").collection("stories");
const packagesCollection = client.db("test").collection("packages");
const wishlistCollection = client.db("test").collection("wishlist");
const bookingsCollection = client.db("test").collection("bookings");
const paymentCollection = client.db("test").collection("payments");
const communityCollection = client.db("test").collection('community');
const blogCollection = client.db("test").collection('blogs');


// JWT/POST-creating Token
app.post('/jwt', async (req, res) => {
    const user = req.body;
    const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
    res.send({ token });
});

const verifyToken = (req, res, next) => {
    if (!req.headers.authorization) {
        return res.status(401).send({ message: 'unauthorized access' });
    }
    const token = req.headers.authorization.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ message: 'unauthorized access' });
        }
        req.decoded = decoded;
        next();
    });
};

// use verify admin after verifyToken
const verifyAdmin = async (req, res, next) => {
    const email = req.decoded.email;
    const query = { email: email };
    const user = await userCollection.findOne(query);
    const isAdmin = user?.role === 'admin';
    if (!isAdmin) {
        return res.status(403).send({ message: 'forbidden access' });
    }
    next();
};

// Endpoint to fetch user profile based on email
app.get('/api/profile', async (req, res) => {
    try {
        const email = req.query.email;
        const user = await userCollection.findOne({ email });
        if (user) {
            res.status(200).json(user);
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Endpoint to register user and save to database first
app.post('/register', async (req, res) => {
    const { email, name, photoURL, role } = req.body;

    const newUser = {
        email,
        name,
        photoURL,
        role: role || 'tourist', // Assign default role if not provided
        createdAt: new Date(),
    };

    try {
        // Check if the user already exists
        const existingUser = await userCollection.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'User already exists' });
        }

        // Save the user to the database
        const result = await userCollection.insertOne(newUser);
        if (result.insertedId) {
            res.status(201).json({ success: true, message: 'User registered successfully', user: newUser });
        } else {
            throw new Error('Error inserting user to database');
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error registering user', error: error.message });
    }
});

// Endpoint to check if a user exists by email
app.get('/users', async (req, res) => {
    const { email } = req.query;
    try {
        const user = await userCollection.findOne({ email });
        if (user) {
            res.status(200).json({ exists: true, user });
        } else {
            res.status(200).json({ exists: false });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error checking user existence', error: error.message });
    }
});

// Endpoint to handle story submission
app.post('/api/story', async (req, res) => {
    const { email, title, excerpt, content } = req.body;
    try {
        const user = await userCollection.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const newStory = {
            email,
            title,
            excerpt,
            content,
            posterName: user.name,
            posterPhotoURL: user.photoURL,
            createdAt: new Date()
        };

        const result = await storiesCollection.insertOne(newStory);
        res.status(200).json({ message: 'Story submitted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error submitting story', error: error.message });
    }
});

// Endpoint to handle guide info submission
app.post('/api/profile', async (req, res) => {
    const { email, bio, experience, contact, education, skills } = req.body;
    try {
        await userCollection.updateOne({ email }, {
            $set: {
                bio,
                experience,
                contact,
                education,
                skills
            }
        });
        res.status(200).json({ message: 'Guide info submitted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error submitting guide info', error: error.message });
    }
});

// Endpoint to fetch guides information
app.get('/api/guides', async (req, res) => {
    try {
        const guides = await userCollection.find({ role: 'tourguide' }).toArray();
        res.status(200).json(guides);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

// Endpoint to handle package creation
app.post('/api/packages', upload.array('images'), async (req, res) => {
    const { packageName, about, tourPlan, guide, price, type } = req.body;
    const images = req.files ? req.files.map(file => file.buffer) : [];

    const newPackage = {
        packageName,
        images,
        about,
        tourPlan: JSON.parse(tourPlan),
        guide,
        price,
        type,
        createdAt: new Date(),
    };

    try {
        const result = await packagesCollection.insertOne(newPackage);
        if (result.insertedId) {
            res.status(201).json({ success: true, message: 'Package added successfully', package: newPackage });
        } else {
            throw new Error('Error inserting package to database');
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error adding package', error: error.message });
    }
});

// Endpoint to request to become a tour guide
app.post('/api/request-tour-guide', async (req, res) => {
    const { email } = req.body;

    try {
        const result = await userCollection.updateOne(
            { email },
            { $set: { requestRole: 'tourguide' } }
        );

        if (result.modifiedCount > 0) {
            res.status(200).json({ success: true, message: 'Request sent successfully' });
        } else {
            res.status(404).json({ success: false, message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error sending request', error: error.message });
    }
});

// Endpoint to process role request decisions
app.patch('/api/users/:id/request', async (req, res) => {
    const userId = req.params.id;
    const { decision } = req.body;
    try {
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        if (decision === 'approved') {
            await userCollection.updateOne(
                { _id: new ObjectId(userId) },
                { $set: { role: user.requestRole, requestRole: null } }
            );
        } else {
            await userCollection.updateOne(
                { _id: new ObjectId(userId) },
                { $set: { requestRole: null } }
            );
        }
        res.status(200).json({ success: true, message: 'Request processed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error processing request', error: error.message });
    }
});


// Endpoint to fetch all users with search and filter
app.get('/api/users', async (req, res) => {
    const { search, role } = req.query;
    let query = {};

    if (search) {
        query.$or = [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } }
        ];
    }

    if (role) {
        query.role = role;
    }

    try {
        const users = await userCollection.find(query).toArray();
        res.status(200).json(users);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Endpoint to fetch all packages
app.get('/api/packages', async (req, res) => {
    try {
        const packages = await packagesCollection.find({}).toArray();
        res.status(200).json(packages);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Add to wishlist
app.post('/api/wishlist', verifyToken, async (req, res) => {
    const { email, packageId } = req.body;

    try {
        const wishlistItem = await wishlistCollection.findOne({ email, packageId });
        if (wishlistItem) {
            return res.status(400).json({ message: 'Package already in wishlist' });
        }

        await wishlistCollection.insertOne({ email, packageId, createdAt: new Date() });
        res.status(201).json({ message: 'Package added to wishlist' });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', error });
    }
});

// Remove from wishlist
app.delete('/api/wishlist', verifyToken, async (req, res) => {
    const { email, packageId } = req.body;

    try {
        const result = await wishlistCollection.deleteOne({ email, packageId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Package not found in wishlist' });
        }

        res.status(200).json({ message: 'Package removed from wishlist' });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', error });
    }
});

// Endpoint to fetch wishlist for a specific user
app.get('/api/wishlist/:email', verifyToken, async (req, res) => {
    const email = req.params.email;

    try {
        const wishlistItems = await wishlistCollection.find({ email }).toArray();
        res.status(200).json(wishlistItems);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', error });
    }
});

// Endpoint to fetch a package by ID
app.get('/api/packages/:id', async (req, res) => {
    const packageId = req.params.id;
    try {
        const package = await packagesCollection.findOne({ _id: new ObjectId(packageId) });
        if (!package) {
            return res.status(404).json({ message: 'Package not found' });
        }
        res.status(200).json(package);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', error });
    }
});

// Endpoint to fetch packages by their IDs
app.post('/api/packages/byIds', async (req, res) => {
    const { packageIds } = req.body;

    if (!Array.isArray(packageIds) || packageIds.length === 0) {
        return res.status(400).json({ message: 'Invalid package IDs' });
    }

    try {
        const objectIds = packageIds.map(id => new ObjectId(id));
        const packages = await packagesCollection.find({ _id: { $in: objectIds } }).toArray();
        res.status(200).json(packages);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', error });
    }
});

// Endpoint to fetch packages by type
app.get('/api/packages/type/:type', async (req, res) => {
    const type = req.params.type;
    try {
        const packages = await packagesCollection.find({ type: { $regex: new RegExp(`^${type}$`, 'i') } }).toArray();
        res.status(200).json(packages);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});




// Endpoint to fetch guide by ID
app.get('/api/guides/:id', async (req, res) => {
    const guideId = req.params.id;
    try {
        const guide = await userCollection.findOne({ _id: new ObjectId(guideId), role: 'tourguide' });
        if (!guide) {
            return res.status(404).json({ message: 'Guide not found' });
        }
        res.status(200).json(guide);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

// Endpoint to add review to guide
app.post('/api/guides/:id/review', verifyToken, async (req, res) => {
    const guideId = req.params.id;
    const { rating, comment, email } = req.body;

    try {
        const guide = await userCollection.findOne({ _id: new ObjectId(guideId), role: 'tourguide' });
        if (!guide) {
            return res.status(404).json({ message: 'Guide not found' });
        }

        const review = { rating, comment, email, date: new Date() };
        await userCollection.updateOne(
            { _id: new ObjectId(guideId) },
            { $push: { reviews: review } }
        );

        res.status(200).json({ message: 'Review added successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

// Endpoint to fetch all stories
app.get('/api/stories', async (req, res) => {
    try {
        const stories = await storiesCollection.find({}).toArray();
        res.status(200).json(stories);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Endpoint to fetch a single story by ID
app.get('/api/stories/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const story = await storiesCollection.findOne({ _id: new ObjectId(id) });
        if (!story) {
            return res.status(404).json({ message: 'Story not found' });
        }
        res.status(200).json(story);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Endpoint to fetch all bookings for a user
app.get('/api/bookings', verifyToken, async (req, res) => {
    const { email } = req.query;
    try {
        const bookings = await bookingsCollection.find({ email }).toArray();
        res.status(200).json(bookings);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', error });
    }
});

// Endpoint to add a new booking
app.post('/api/bookings', verifyToken, async (req, res) => {
    const { packageId, email, startDate, guide } = req.body;
    try {
        const packageDetails = await packagesCollection.findOne({ _id: new ObjectId(packageId) });
        if (!packageDetails) {
            return res.status(404).json({ message: 'Package not found' });
        }

        const tourist = await userCollection.findOne({ email });
        if (!tourist) {
            return res.status(404).json({ message: 'Tourist not found' });
        }

        const newBooking = {
            packageId,
            packageName: packageDetails.packageName,
            guide,
            startDate: new Date(startDate),
            price: packageDetails.price,
            status: 'In Review',
            email,
            touristName: tourist.displayName,
            createdAt: new Date(),
        };

        const result = await bookingsCollection.insertOne(newBooking);
        res.status(201).json({ success: true, booking: newBooking });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', error });
    }
});

// Endpoint to delete a booking (for canceling)
app.delete('/api/bookings/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await bookingsCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) {
            res.status(200).json({ success: true, message: 'Booking cancelled successfully' });
        } else {
            res.status(404).json({ message: 'Booking not found' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', error });
    }
});

// Endpoint to fetch assigned tours for a guide
app.get('/api/assigned-tours', verifyToken, async (req, res) => {
    const { guide } = req.query;
    try {
        const assignedTours = await bookingsCollection.find({ guide }).toArray();
        res.status(200).json(assignedTours);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', error });
    }
});

// Endpoint to update booking status
app.patch('/api/bookings/:id/status', verifyToken, async (req, res) => {
    const bookingId = req.params.id;
    const { status } = req.body;
    try {
        const result = await bookingsCollection.updateOne(
            { _id: new ObjectId(bookingId) },
            { $set: { status } }
        );
        if (result.modifiedCount === 1) {
            res.status(200).json({ message: 'Booking status updated' });
        } else {
            res.status(404).json({ message: 'Booking not found' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', error });
    }
});

// Endpoint to create a payment intent
app.post('/create-payment-intent', async (req, res) => {
    const { price } = req.body;
    const amount = parseInt(price * 100); // Convert to smallest currency unit

    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: 'usd',
            payment_method_types: ['card'],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Endpoint to save payment information
app.post('/payments', async (req, res) => {
    const payment = req.body;
    try {
        const paymentResult = await paymentCollection.insertOne(payment);

        // Update booking status to 'Paid'
        await bookingsCollection.updateOne(
            { _id: new ObjectId(payment.bookingId) },
            { $set: { status: 'Paid' } }
        );

        res.send({ paymentResult });
    } catch (error) {
        console.error('Error saving payment information:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


// Get Payments for User
app.get('/payments/:email', verifyToken, async (req, res) => {
    const query = { email: req.params.email };
    if (req.params.email !== req.decoded.email) {
        return res.status(403).send({ message: 'forbidden access' });
    }
    const result = await paymentCollection.find(query).toArray();
    res.send(result);
});

// API to fetch community posts
app.get('/api/community', async (req, res) => {
    try {
        const posts = await communityCollection.find({}).toArray();
        res.status(200).json(posts);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', error });
    }
});

// API to fetch blog posts
app.get('/api/blogs', async (req, res) => {
    try {
      const blogs = await blogCollection.find({}).toArray();
      res.status(200).json(blogs);
    } catch (error) {
      res.status(500).json({ message: 'Internal server error', error });
    }
  });


app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
