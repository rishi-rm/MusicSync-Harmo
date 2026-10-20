import mongoose from "mongoose";

export async function connectDB() {
    try {
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI

        if (!mongoUri) {
            throw new Error('MONGODB_URI is not configured.')
        }

        await mongoose.connect(mongoUri)

        console.log("MongoDB connected successfully");
    } catch (error) {
        console.error("MongoDB connection failed:", error.message);

        process.exit(1);
    }
}