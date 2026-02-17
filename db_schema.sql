-- Create the database if it doesn't exist
CREATE DATABASE IF NOT EXISTS cablink_db;
USE cablink_db;

-- Drop tables in reverse order of dependency to avoid foreign key errors
DROP TABLE IF EXISTS `notifications`, `payment_transactions`, `chat_messages`, `expenses`, `bookings`, `routes`, `cars`, `users`, `subscription_plans`;

-- Table structure for users first, as it's referenced
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `phone` varchar(20) NOT NULL,
  `role` enum('Admin','Customer','Driver','Car Owner') NOT NULL,
  `password` varchar(255) NOT NULL,
  `status` ENUM('Active', 'Deleted') NOT NULL DEFAULT 'Active',
  `subscriptionPlanId` int(11) DEFAULT NULL,
  `subscriptionExpiryDate` date DEFAULT NULL,
  `profilePictureUrl` varchar(2048) DEFAULT NULL,
  `profilePictureData` LONGBLOB DEFAULT NULL,
  `qrCodeUrl` varchar(2048) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for subscription plans
CREATE TABLE IF NOT EXISTS `subscription_plans` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `durationMonths` int(11) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `customerDiscountPercent` int(11) NOT NULL DEFAULT 0,
  `providerId` int(11) NOT NULL,
  `providerRole` enum('Admin','Driver') NOT NULL,
  `providerName` varchar(255) DEFAULT NULL,
  `status` ENUM('Active', 'Deleted') NOT NULL DEFAULT 'Active',
  PRIMARY KEY (`id`),
  KEY `providerId` (`providerId`),
  CONSTRAINT `subscription_plans_ibfk_1` FOREIGN KEY (`providerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Add foreign key to users table after subscription_plans is defined
ALTER TABLE `users`
ADD KEY `subscriptionPlanId` (`subscriptionPlanId`),
ADD CONSTRAINT `users_ibfk_1` FOREIGN KEY (`subscriptionPlanId`) REFERENCES `subscription_plans` (`id`) ON DELETE SET NULL;

-- Dumping data for table `users` (with NULL subscriptions initially to break circular dependency)
INSERT INTO `users` (`id`, `name`, `email`, `phone`, `role`, `password`, `status`, `subscriptionPlanId`, `subscriptionExpiryDate`, `profilePictureUrl`, `qrCodeUrl`) VALUES
(1, 'Admin User', 'admin@cablink.com', '9876543210', 'Admin', '$2a$10$w2DR5Xv2/HHn542C1si49uS0m7b6plu2vI3A.Lz6zK8z9w3x1v4wK', 'Active', NULL, NULL, 'https://picsum.photos/id/237/200', NULL),
(2, 'Customer User', 'customer@cablink.com', '9123456789', 'Customer', '$2a$10$w2DR5Xv2/HHn542C1si49uS0m7b6plu2vI3A.Lz6zK8z9w3x1v4wK', 'Active', NULL, NULL, 'https://picsum.photos/id/238/200', NULL),
(3, 'Ramesh Patel', 'driver@cablink.com', '9820098200', 'Driver', '$2a$10$w2DR5Xv2/HHn542C1si49uS0m7b6plu2vI3A.Lz6zK8z9w3x1v4wK', 'Active', NULL, NULL, 'https://picsum.photos/id/239/200', 'https://i.imgur.com/HFAw13v.png'),
(4, 'Suresh Kumar', 'suresh@cablink.com', '9870098700', 'Driver', '$2a$10$w2DR5Xv2/HHn542C1si49uS0m7b6plu2vI3A.Lz6zK8z9w3x1v4wK', 'Active', NULL, NULL, 'https://picsum.photos/id/240/200', NULL),
(5, 'Anil Gupta', 'anil@cablink.com', '9988776655', 'Driver', '$2a$10$w2DR5Xv2/HHn542C1si49uS0m7b6plu2vI3A.Lz6zK8z9w3x1v4wK', 'Active', NULL, NULL, 'https://picsum.photos/id/241/200', NULL),
(6, 'Car Owner User', 'owner@cablink.com', '9999988888', 'Car Owner', '$2a$10$w2DR5Xv2/HHn542C1si49uS0m7b6plu2vI3A.Lz6zK8z9w3x1v4wK', 'Active', NULL, NULL, 'https://picsum.photos/id/242/200', 'https://i.imgur.com/HFAw13v.png');

-- Dumping data for table `subscription_plans`
INSERT INTO `subscription_plans` (`id`, `name`, `durationMonths`, `price`, `customerDiscountPercent`, `providerId`, `providerRole`, `providerName`, `status`) VALUES
(1, 'Global Prime - 1 Month', 1, 999.00, 10, 1, 'Admin', 'Admin', 'Active'),
(2, 'Global Prime - 6 Months', 6, 4999.00, 15, 1, 'Admin', 'Admin', 'Active'),
(3, 'Ramesh Patel''s Fan Club', 3, 599.00, 20, 3, 'Driver', 'Ramesh Patel', 'Active');

-- Update user subscriptions after plans are created
UPDATE `users` SET `subscriptionPlanId` = 3, `subscriptionExpiryDate` = DATE_ADD(CURDATE(), INTERVAL 3 MONTH) WHERE `id` = 2;

-- Table structure for cars
CREATE TABLE IF NOT EXISTS `cars` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `carNumber` varchar(20) NOT NULL,
  `model` varchar(255) NOT NULL,
  `driverId` int(11) DEFAULT NULL,
  `capacity` int(11) NOT NULL,
  `pricePerKm` decimal(10,2) NOT NULL,
  `minKmPerDay` int(11) DEFAULT NULL,
  `imageUrl` varchar(2048) DEFAULT NULL,
  `imageData` LONGBLOB DEFAULT NULL,
  `status` ENUM('Pending Payment', 'Pending Approval', 'Active', 'Subscription Expired', 'Deleted') NOT NULL DEFAULT 'Pending Payment',
  `subscriptionExpiryDate` date DEFAULT NULL,
  `latitude` DECIMAL(10, 8) DEFAULT NULL,
  `longitude` DECIMAL(11, 8) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `driverId` (`driverId`),
  CONSTRAINT `cars_ibfk_1` FOREIGN KEY (`driverId`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Dumping data for table `cars`
INSERT INTO `cars` (`id`, `carNumber`, `model`, `driverId`, `capacity`, `pricePerKm`, `minKmPerDay`, `imageUrl`, `status`, `subscriptionExpiryDate`, `latitude`, `longitude`) VALUES
(1, 'MH-12-AB-1234', 'Toyota Innova', 3, 7, 15.00, 150, 'https://picsum.photos/id/111/400/250', 'Active', DATE_ADD(CURDATE(), INTERVAL 6 MONTH), 18.5204, 73.8567),
(2, 'DL-03-CD-5678', 'Maruti Suzuki Dzire', 4, 4, 12.00, 100, 'https://picsum.photos/id/1071/400/250', 'Active', DATE_ADD(CURDATE(), INTERVAL 12 MONTH), 28.7041, 77.1025),
(3, 'KA-05-EF-9012', 'Hyundai Verna', 5, 4, 14.00, NULL, 'https://picsum.photos/id/1075/400/250', 'Pending Approval', DATE_ADD(CURDATE(), INTERVAL 1 MONTH), 12.9716, 77.5946),
(4, 'PB-01-GH-3456', 'Mahindra XUV700', 6, 7, 18.00, 200, 'https://picsum.photos/id/1076/400/250', 'Pending Payment', NULL, 30.7333, 76.7794);


-- Table structure for routes
CREATE TABLE IF NOT EXISTS `routes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `from` varchar(255) NOT NULL,
  `to` varchar(255) NOT NULL,
  `date` date NOT NULL,
  `time` time NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `carId` int(11) NOT NULL,
  `seatsOffered` INT NULL,
  `from_lat` DECIMAL(10, 8) DEFAULT NULL,
  `from_lng` DECIMAL(11, 8) DEFAULT NULL,
  `to_lat` DECIMAL(10, 8) DEFAULT NULL,
  `to_lng` DECIMAL(11, 8) DEFAULT NULL,
  `status` ENUM('Active', 'Deleted') NOT NULL DEFAULT 'Active',
  PRIMARY KEY (`id`),
  KEY `carId` (`carId`),
  CONSTRAINT `routes_ibfk_1` FOREIGN KEY (`carId`) REFERENCES `cars` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Dumping data for table `routes`
INSERT INTO `routes` (`id`, `from`, `to`, `date`, `time`, `price`, `carId`, `seatsOffered`, `from_lat`, `from_lng`) VALUES
(1, 'Mumbai Airport', 'Pune City', DATE_ADD(CURDATE(), INTERVAL 2 DAY), '10:00:00', 500.00, 1, 6, 19.0896, 72.8656),
(2, 'Delhi Station', 'Gurgaon Sector 29', DATE_ADD(CURDATE(), INTERVAL 3 DAY), '14:00:00', 200.00, 2, 4, 28.642, 77.219),
(3, 'Bangalore Airport', 'Koramangala', DATE_ADD(CURDATE(), INTERVAL 4 DAY), '19:00:00', 300.00, 3, 4, 13.1989, 77.7068);


-- Table structure for bookings
CREATE TABLE IF NOT EXISTS `bookings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `userId` int(11) NOT NULL,
  `bookingDate` date NOT NULL,
  `bookingType` enum('Route','Private','Parcel') NOT NULL,
  `status` enum('Confirmed','Completed','Cancelled','In Transit') NOT NULL,
  `paymentStatus` enum('Pending','Paid','Failed','Refunded') NOT NULL DEFAULT 'Pending',
  `totalPrice` decimal(10,2) NOT NULL,
  `routeId` int(11) DEFAULT NULL,
  `seatsBooked` int(11) DEFAULT NULL,
  `carId` int(11) DEFAULT NULL,
  `pickupLocation` varchar(255) DEFAULT NULL,
  `dropoffLocation` varchar(255) DEFAULT NULL,
  `startDate` datetime DEFAULT NULL,
  `endDate` datetime DEFAULT NULL,
  `actualDistanceKm` int(11) DEFAULT NULL,
  `parcelSize` enum('Small','Medium','Large') DEFAULT NULL,
  `parcelDescription` text DEFAULT NULL,
  `recipientName` varchar(255) DEFAULT NULL,
  `recipientPhone` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `userId` (`userId`),
  KEY `routeId` (`routeId`),
  KEY `carId_private` (`carId`),
  CONSTRAINT `bookings_ibfk_1` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `bookings_ibfk_2` FOREIGN KEY (`routeId`) REFERENCES `routes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `bookings_ibfk_3` FOREIGN KEY (`carId`) REFERENCES `cars` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Dumping data for table `bookings`
INSERT INTO `bookings` (`id`, `userId`, `bookingDate`, `bookingType`, `status`, `paymentStatus`, `totalPrice`, `routeId`) VALUES
(1, 2, CURDATE(), 'Route', 'Confirmed', 'Pending', 800.00, 1),
(2, 2, DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'Route', 'Completed', 'Paid', 300.00, 3),
(3, 2, DATE_SUB(CURDATE(), INTERVAL 10 DAY), 'Private', 'Completed', 'Paid', 1600.00, NULL);


-- Table structure for expenses
CREATE TABLE IF NOT EXISTS `expenses` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `carId` int(11) NOT NULL,
  `expenseType` enum('Fuel','Servicing','Driver','Tires','Other') NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `date` date NOT NULL,
  `description` text DEFAULT NULL,
  `status` ENUM('Active', 'Deleted') NOT NULL DEFAULT 'Active',
  PRIMARY KEY (`id`),
  KEY `carId` (`carId`),
  CONSTRAINT `expenses_ibfk_1` FOREIGN KEY (`carId`) REFERENCES `cars` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Dumping data for table `expenses`
INSERT INTO `expenses` (`id`, `carId`, `expenseType`, `amount`, `date`, `description`) VALUES
(1, 1, 'Fuel', 3000.00, DATE_SUB(CURDATE(), INTERVAL 10 DAY), 'Full tank'),
(2, 2, 'Servicing', 5000.00, DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'Oil change and inspection'),
(3, 1, 'Driver', 15000.00, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'Monthly salary'),
(4, 3, 'Tires', 8000.00, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'New set of tires');

-- Table structure for chat messages
CREATE TABLE IF NOT EXISTS `chat_messages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `bookingId` int(11) NOT NULL,
  `senderId` int(11) NOT NULL,
  `message` text NOT NULL,
  `timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `isRead` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `bookingId` (`bookingId`),
  KEY `senderId` (`senderId`),
  CONSTRAINT `chat_messages_ibfk_1` FOREIGN KEY (`bookingId`) REFERENCES `bookings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chat_messages_ibfk_2` FOREIGN KEY (`senderId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Dumping data for table `chat_messages`
INSERT INTO `chat_messages` (`id`, `bookingId`, `senderId`, `message`, `timestamp`, `isRead`) VALUES
(1, 1, 2, 'Hi, I just booked a ride. Wanted to confirm the pickup point.', DATE_SUB(NOW(), INTERVAL 5 MINUTE), 1),
(2, 1, 3, 'Hello! Yes, confirmed. I will be at Terminal 2, Gate 4.', DATE_SUB(NOW(), INTERVAL 4 MINUTE), 0);

-- Table structure for payment transactions
CREATE TABLE IF NOT EXISTS `payment_transactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `booking_id` int(11) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `car_id` int(11) DEFAULT NULL,
  `transaction_type` enum('Booking','Membership','CarRegistration') NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `gateway_transaction_id` varchar(255) NOT NULL,
  `status` enum('Success','Failed') NOT NULL DEFAULT 'Success',
  `payment_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `booking_id` (`booking_id`),
  KEY `user_id` (`user_id`),
  KEY `car_id` (`car_id`),
  CONSTRAINT `payment_transactions_ibfk_1` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE SET NULL,
  CONSTRAINT `payment_transactions_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `payment_transactions_ibfk_3` FOREIGN KEY (`car_id`) REFERENCES `cars` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for notifications
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `booking_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `type` enum('BookingConfirmation','BookingCancellation','PaymentReminder') NOT NULL,
  `channel` enum('Email','SMS','WhatsApp') NOT NULL,
  `status` enum('Pending','Sent','Failed') NOT NULL DEFAULT 'Pending',
  `message` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `sent_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `booking_id` (`booking_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `notifications_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;