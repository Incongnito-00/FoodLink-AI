const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const pool = require("./db");

const app = express();

const JWT_SECRET =
    process.env.JWT_SECRET || "foodshare_development_secret";

const PORT = process.env.PORT || 5000;


/* =========================================================
   MIDDLEWARE
   ========================================================= */

app.use(cors());
app.use(express.json());

app.use(
    express.static(
        path.join(__dirname, "..")
    )
);


/* =========================================================
   AUTHENTICATION
   ========================================================= */

function auth(req, res, next) {

    const header =
        req.headers.authorization || "";

    const token =
        header.startsWith("Bearer ")
            ? header.slice(7)
            : null;

    if (!token) {

        return res.status(401).json({
            success: false,
            message: "Authentication required"
        });
    }

    try {

        req.user =
            jwt.verify(
                token,
                JWT_SECRET
            );

        next();

    } catch (error) {

        return res.status(401).json({
            success: false,
            message: "Invalid or expired session"
        });
    }
}


/* =========================================================
   ROLE CHECK
   ========================================================= */

function role(...roles) {

    return (req, res, next) => {

        if (!roles.includes(req.user.role)) {

            return res.status(403).json({
                success: false,
                message:
                    "You do not have permission for this action"
            });
        }

        next();
    };
}


/* =========================================================
   HELPER
   ========================================================= */

function bad(
    res,
    message,
    code = 400
) {

    return res.status(code).json({
        success: false,
        message
    });
}


function validDate(value) {

    const date = new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return null;
    }

    return date;
}


/* =========================================================
   BASIC API
   ========================================================= */

app.get("/api", (req, res) => {

    res.json({
        success: true,
        message: "FoodShare API is running"
    });
});


/* =========================================================
   DATABASE TEST
   ========================================================= */

app.get(
    "/api/db-test",
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    "SELECT NOW() AS current_time"
                );

            res.json({
                success: true,
                message:
                    "PostgreSQL connection successful",
                time:
                    result.rows[0].current_time
            });

        } catch (error) {

            console.error(
                "Database error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Database connection failed"
            });
        }
    }
);


/* =========================================================
   AUTH - REGISTER
   ========================================================= */

app.post(
    "/api/auth/register",
    async (req, res) => {

        try {

            const {
                full_name,
                email,
                password,
                role: userRole,
                phone,
                organization_name,
                location
            } = req.body;


            if (
                !full_name ||
                !email ||
                !password ||
                !userRole
            ) {

                return bad(
                    res,
                    "Full name, email, password and role are required"
                );
            }


            if (
                ![
                    "shopkeeper",
                    "ngo"
                ].includes(userRole)
            ) {

                return bad(
                    res,
                    "Invalid role"
                );
            }


            const normalizedEmail =
                email
                    .trim()
                    .toLowerCase();


            const existing =
                await pool.query(
                    `
                    SELECT id
                    FROM users
                    WHERE email = $1
                    `,
                    [normalizedEmail]
                );


            if (existing.rows.length > 0) {

                return bad(
                    res,
                    "An account with this email already exists",
                    409
                );
            }


            const passwordHash =
                await bcrypt.hash(
                    password,
                    10
                );


            const result =
                await pool.query(
                    `
                    INSERT INTO users
                    (
                        full_name,
                        email,
                        password_hash,
                        role,
                        phone,
                        organization_name,
                        location
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        $7
                    )
                    RETURNING
                        id,
                        full_name,
                        email,
                        role,
                        phone,
                        organization_name,
                        location,
                        created_at
                    `,
                    [
                        full_name.trim(),
                        normalizedEmail,
                        passwordHash,
                        userRole,
                        phone?.trim() || null,
                        organization_name?.trim() || null,
                        location?.trim() || null
                    ]
                );


            const user =
                result.rows[0];


            const token =
                jwt.sign(
                    {
                        id: user.id,
                        role: user.role,
                        email: user.email
                    },
                    JWT_SECRET,
                    {
                        expiresIn: "7d"
                    }
                );


            res.status(201).json({
                success: true,
                message:
                    "Account created successfully",
                token,
                user
            });


        } catch (error) {

            console.error(
                "Registration error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Registration failed"
            });
        }
    }
);


/* =========================================================
   AUTH - LOGIN
   ========================================================= */

app.post(
    "/api/auth/login",
    async (req, res) => {

        try {

            const {
                email,
                password,
                role: userRole
            } = req.body;


            if (
                !email ||
                !password ||
                !userRole
            ) {

                return bad(
                    res,
                    "Email, password and role are required"
                );
            }


            if (
                ![
                    "shopkeeper",
                    "ngo"
                ].includes(userRole)
            ) {

                return bad(
                    res,
                    "Invalid role"
                );
            }


            const result =
                await pool.query(
                    `
                    SELECT *
                    FROM users
                    WHERE email = $1
                    AND role = $2
                    `,
                    [
                        email
                            .trim()
                            .toLowerCase(),
                        userRole
                    ]
                );


            if (
                result.rows.length === 0
            ) {

                return bad(
                    res,
                    "Invalid email, password or role",
                    401
                );
            }


            const user =
                result.rows[0];


            const passwordMatch =
                await bcrypt.compare(
                    password,
                    user.password_hash
                );


            if (!passwordMatch) {

                return bad(
                    res,
                    "Invalid email, password or role",
                    401
                );
            }


            const token =
                jwt.sign(
                    {
                        id: user.id,
                        role: user.role,
                        email: user.email
                    },
                    JWT_SECRET,
                    {
                        expiresIn: "7d"
                    }
                );


            delete user.password_hash;


            res.json({
                success: true,
                message:
                    "Login successful",
                token,
                user
            });


        } catch (error) {

            console.error(
                "Login error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Login failed"
            });
        }
    }
);


/* =========================================================
   FOOD
   ========================================================= */

const FOOD_SELECT = `
    SELECT
        f.*,
        u.email AS donor_email,
        u.full_name AS donor_name,
        u.organization_name,
        u.location AS donor_location
    FROM food_listings f
    JOIN users u
        ON f.donor_id = u.id
`;


/* =========================================================
   GET FOOD
   ========================================================= */

app.get(
    "/api/food",
    auth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    ${FOOD_SELECT}
                    ORDER BY f.created_at DESC
                    `
                );


            res.json({
                success: true,
                food: result.rows
            });


        } catch (error) {

            console.error(
                "Food fetch error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to fetch food listings"
            });
        }
    }
);


/* =========================================================
   ADD FOOD
   ========================================================= */

app.post(
    "/api/food",
    auth,
    role("shopkeeper"),
    async (req, res) => {

        try {

            const {
                food_name,
                quantity,
                unit,
                food_type,
                prepared_at,
                best_before,
                description
            } = req.body;


            if (
                !food_name ||
                quantity === undefined ||
                !unit ||
                !best_before
            ) {

                return bad(
                    res,
                    "Food name, quantity, unit and best-before time are required"
                );
            }


            const qty =
                Number(quantity);


            if (
                !Number.isFinite(qty) ||
                qty <= 0
            ) {

                return bad(
                    res,
                    "Quantity must be greater than zero"
                );
            }


            const best =
                validDate(
                    best_before
                );


            if (!best) {

                return bad(
                    res,
                    "Invalid best-before date"
                );
            }


            const prepared =
                prepared_at
                    ? validDate(prepared_at)
                    : null;


            if (
                prepared_at &&
                !prepared
            ) {

                return bad(
                    res,
                    "Invalid prepared date"
                );
            }


            if (
                prepared &&
                best <= prepared
            ) {

                return bad(
                    res,
                    "Best-before time must be after the prepared time"
                );
            }


            if (
                best <= new Date()
            ) {

                return bad(
                    res,
                    "Best-before time must be in the future"
                );
            }


            const result =
                await pool.query(
                    `
                    INSERT INTO food_listings
                    (
                        donor_id,
                        food_name,
                        quantity,
                        unit,
                        food_type,
                        prepared_at,
                        best_before,
                        description,
                        status
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        $7,
                        $8,
                        'available'
                    )
                    RETURNING *
                    `,
                    [
                        req.user.id,
                        food_name.trim(),
                        qty,
                        unit.trim(),
                        food_type?.trim() || null,
                        prepared,
                        best,
                        description?.trim() || null
                    ]
                );


            res.status(201).json({
                success: true,
                message:
                    "Food listing added successfully",
                food:
                    result.rows[0]
            });


        } catch (error) {

            console.error(
                "Food creation error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to add food listing"
            });
        }
    }
);


/* =========================================================
   UPDATE EXPIRED FOOD
   ========================================================= */

app.patch(
    "/api/food/update-expired",
    auth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    UPDATE food_listings
                    SET status = 'expired'
                    WHERE best_before <= CURRENT_TIMESTAMP
                    AND status IN
                    (
                        'available',
                        'requested',
                        'accepted'
                    )
                    RETURNING id
                    `
                );


            res.json({
                success: true,
                message:
                    "Expired food listings updated",
                count:
                    result.rowCount
            });


        } catch (error) {

            console.error(
                "Expiry update error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to update expired food listings"
            });
        }
    }
);


/* =========================================================
   CANCEL FOOD
   ========================================================= */

app.patch(
    "/api/food/:id/cancel",
    auth,
    role("shopkeeper"),
    async (req, res) => {

        const client =
            await pool.connect();


        try {

            await client.query(
                "BEGIN"
            );


            const result =
                await client.query(
                    `
                    SELECT *
                    FROM food_listings
                    WHERE id = $1
                    AND donor_id = $2
                    FOR UPDATE
                    `,
                    [
                        Number(req.params.id),
                        req.user.id
                    ]
                );


            if (
                result.rows.length === 0
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return bad(
                    res,
                    "Food listing not found",
                    404
                );
            }


            const food =
                result.rows[0];


            if (
                [
                    "collected",
                    "cancelled",
                    "expired"
                ].includes(food.status)
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return bad(
                    res,
                    "This food listing cannot be cancelled"
                );
            }


            await client.query(
                `
                UPDATE food_listings
                SET status = 'cancelled'
                WHERE id = $1
                `,
                [food.id]
            );


            await client.query(
                `
                UPDATE donation_requests
                SET
                    status = 'cancelled',
                    responded_at = CURRENT_TIMESTAMP
                WHERE food_id = $1
                AND status IN
                (
                    'pending',
                    'accepted'
                )
                `,
                [food.id]
            );


            await client.query(
                "COMMIT"
            );


            res.json({
                success: true,
                message:
                    "Food listing cancelled"
            });


        } catch (error) {

            await client.query(
                "ROLLBACK"
            );

            console.error(
                "Food cancellation error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to cancel food listing"
            });


        } finally {

            client.release();
        }
    }
);


/* =========================================================
   DONATION REQUESTS
   ========================================================= */

const REQUEST_SELECT = `
    SELECT
        r.id,
        r.food_id,
        r.ngo_id,
        r.status,
        r.requested_at,
        r.responded_at,

        f.food_name,
        f.quantity,
        f.unit,
        f.food_type,
        f.best_before,
        f.description,
        f.status AS food_status,
        f.donor_id,

        donor.email AS donor_email,
        donor.full_name AS donor_name,
        donor.organization_name AS donor_organization,
        donor.location AS donor_location,

        ngo.email AS ngo_email,
        ngo.full_name AS ngo_name,
        ngo.organization_name AS ngo_organization

    FROM donation_requests r

    JOIN food_listings f
        ON r.food_id = f.id

    JOIN users donor
        ON f.donor_id = donor.id

    JOIN users ngo
        ON r.ngo_id = ngo.id
`;


/* =========================================================
   GET REQUESTS
   ========================================================= */

app.get(
    "/api/requests",
    auth,
    async (req, res) => {

        try {

            const where =
                req.user.role === "shopkeeper"
                    ? "f.donor_id = $1"
                    : "r.ngo_id = $1";


            const result =
                await pool.query(
                    `
                    ${REQUEST_SELECT}
                    WHERE ${where}
                    ORDER BY r.requested_at DESC
                    `,
                    [req.user.id]
                );


            res.json({
                success: true,
                requests:
                    result.rows
            });


        } catch (error) {

            console.error(
                "Request fetch error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to fetch donation requests"
            });
        }
    }
);


/* =========================================================
   NGO - CREATE REQUEST
   ========================================================= */

app.post(
    "/api/requests",
    auth,
    role("ngo"),
    async (req, res) => {

        const client =
            await pool.connect();


        try {

            const foodId =
                Number(
                    req.body.food_id
                );


            if (
                !Number.isInteger(foodId) ||
                foodId <= 0
            ) {

                return bad(
                    res,
                    "Valid food ID is required"
                );
            }


            await client.query(
                "BEGIN"
            );


            const result =
                await client.query(
                    `
                    SELECT *
                    FROM food_listings
                    WHERE id = $1
                    FOR UPDATE
                    `,
                    [foodId]
                );


            if (
                result.rows.length === 0
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return bad(
                    res,
                    "Food listing not found",
                    404
                );
            }


            const food =
                result.rows[0];


            if (
                new Date(
                    food.best_before
                ) <= new Date()
            ) {

                await client.query(
                    `
                    UPDATE food_listings
                    SET status = 'expired'
                    WHERE id = $1
                    `,
                    [foodId]
                );


                await client.query(
                    "COMMIT"
                );


                return bad(
                    res,
                    "This food has expired"
                );
            }


            if (
                food.status !==
                "available"
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return bad(
                    res,
                    "This food is no longer available"
                );
            }


            const duplicate =
                await client.query(
                    `
                    SELECT id
                    FROM donation_requests
                    WHERE food_id = $1
                    AND ngo_id = $2
                    AND status IN
                    (
                        'pending',
                        'accepted'
                    )
                    `,
                    [
                        foodId,
                        req.user.id
                    ]
                );


            if (
                duplicate.rows.length
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return bad(
                    res,
                    "You already have an active request for this food",
                    409
                );
            }


            const request =
                await client.query(
                    `
                    INSERT INTO donation_requests
                    (
                        food_id,
                        ngo_id,
                        status
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        'pending'
                    )
                    RETURNING *
                    `,
                    [
                        foodId,
                        req.user.id
                    ]
                );


            await client.query(
                `
                UPDATE food_listings
                SET status = 'requested'
                WHERE id = $1
                `,
                [foodId]
            );


            await client.query(
                "COMMIT"
            );


            res.status(201).json({
                success: true,
                message:
                    "Donation request sent successfully",
                request:
                    request.rows[0]
            });


        } catch (error) {

            await client.query(
                "ROLLBACK"
            );

            console.error(
                "Request creation error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to create donation request"
            });


        } finally {

            client.release();
        }
    }
);


/* =========================================================
   REQUEST UPDATE HELPER
   ========================================================= */

async function updateRequest(
    req,
    res,
    action
) {

    const client =
        await pool.connect();


    try {

        const requestId =
            Number(req.params.id);


        await client.query(
            "BEGIN"
        );


        const result =
            await client.query(
                `
                SELECT
                    r.*,
                    f.status AS food_status,
                    f.donor_id,
                    f.best_before
                FROM donation_requests r
                JOIN food_listings f
                    ON r.food_id = f.id
                WHERE r.id = $1
                FOR UPDATE
                `,
                [requestId]
            );


        if (
            result.rows.length === 0
        ) {

            await client.query(
                "ROLLBACK"
            );

            return bad(
                res,
                "Donation request not found",
                404
            );
        }


        const request =
            result.rows[0];


        /* ---------- NGO CANCEL ---------- */

        if (
            action === "cancel"
        ) {

            if (
                Number(request.ngo_id) !==
                Number(req.user.id)
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return bad(
                    res,
                    "You can only cancel your own requests",
                    403
                );
            }


            if (
                request.status !==
                "pending"
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return bad(
                    res,
                    "Only pending requests can be cancelled"
                );
            }


            await client.query(
                `
                UPDATE donation_requests
                SET
                    status = 'cancelled',
                    responded_at = CURRENT_TIMESTAMP
                WHERE id = $1
                `,
                [requestId]
            );


            const foodStatus =
                new Date(
                    request.best_before
                ) <= new Date()
                    ? "expired"
                    : "available";


            await client.query(
                `
                UPDATE food_listings
                SET status = $1
                WHERE id = $2
                `,
                [
                    foodStatus,
                    request.food_id
                ]
            );
        }


        /* ---------- SHOPKEEPER ACTIONS ---------- */

        else {

            if (
                Number(request.donor_id) !==
                Number(req.user.id)
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return bad(
                    res,
                    "You can only update requests for your own food",
                    403
                );
            }


            /* ACCEPT */

            if (
                action === "accept"
            ) {

                if (
                    request.status !==
                    "pending" ||
                    request.food_status !==
                    "requested"
                ) {

                    await client.query(
                        "ROLLBACK"
                    );

                    return bad(
                        res,
                        "This request is no longer available for acceptance"
                    );
                }


                await client.query(
                    `
                    UPDATE donation_requests
                    SET
                        status = 'accepted',
                        responded_at = CURRENT_TIMESTAMP
                    WHERE id = $1
                    `,
                    [requestId]
                );


                await client.query(
                    `
                    UPDATE food_listings
                    SET status = 'accepted'
                    WHERE id = $1
                    `,
                    [request.food_id]
                );
            }


            /* REJECT */

            else if (
                action === "reject"
            ) {

                if (
                    request.status !==
                    "pending"
                ) {

                    await client.query(
                        "ROLLBACK"
                    );

                    return bad(
                        res,
                        "This request is no longer pending"
                    );
                }


                await client.query(
                    `
                    UPDATE donation_requests
                    SET
                        status = 'rejected',
                        responded_at = CURRENT_TIMESTAMP
                    WHERE id = $1
                    `,
                    [requestId]
                );


                const foodStatus =
                    new Date(
                        request.best_before
                    ) <= new Date()
                        ? "expired"
                        : "available";


                await client.query(
                    `
                    UPDATE food_listings
                    SET status = $1
                    WHERE id = $2
                    `,
                    [
                        foodStatus,
                        request.food_id
                    ]
                );
            }


            /* COLLECT */

            else if (
                action === "collect"
            ) {

                if (
                    request.status !==
                    "accepted"
                ) {

                    await client.query(
                        "ROLLBACK"
                    );

                    return bad(
                        res,
                        "Only accepted requests can be marked as collected"
                    );
                }


                await client.query(
                    `
                    UPDATE donation_requests
                    SET
                        status = 'collected',
                        responded_at = CURRENT_TIMESTAMP
                    WHERE id = $1
                    `,
                    [requestId]
                );


                await client.query(
                    `
                    UPDATE food_listings
                    SET status = 'collected'
                    WHERE id = $1
                    `,
                    [request.food_id]
                );
            }
        }


        await client.query(
            "COMMIT"
        );


        const messages = {

            accept:
                "Donation request accepted",

            reject:
                "Donation request rejected",

            collect:
                "Donation marked as collected",

            cancel:
                "Donation request cancelled"
        };


        res.json({
            success: true,
            message:
                messages[action]
        });


    } catch (error) {

        await client.query(
            "ROLLBACK"
        );

        console.error(
            `${action} request error:`,
            error
        );

        res.status(500).json({
            success: false,
            message:
                `Failed to ${action} donation request`
        });


    } finally {

        client.release();
    }
}


/* =========================================================
   REQUEST ACTION ROUTES
   ========================================================= */

app.patch(
    "/api/requests/:id/accept",
    auth,
    role("shopkeeper"),
    (req, res) =>
        updateRequest(
            req,
            res,
            "accept"
        )
);


app.patch(
    "/api/requests/:id/reject",
    auth,
    role("shopkeeper"),
    (req, res) =>
        updateRequest(
            req,
            res,
            "reject"
        )
);


app.patch(
    "/api/requests/:id/collect",
    auth,
    role("shopkeeper"),
    (req, res) =>
        updateRequest(
            req,
            res,
            "collect"
        )
);


app.patch(
    "/api/requests/:id/cancel",
    auth,
    role("ngo"),
    (req, res) =>
        updateRequest(
            req,
            res,
            "cancel"
        )
);


/* =========================================================
   PROFILE - GET
   ========================================================= */

app.get(
    "/api/profile",
    auth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        full_name,
                        email,
                        role,
                        phone,
                        organization_name,
                        location,
                        created_at
                    FROM users
                    WHERE id = $1
                    `,
                    [req.user.id]
                );


            if (
                result.rows.length === 0
            ) {

                return bad(
                    res,
                    "Profile not found",
                    404
                );
            }


            res.json({
                success: true,
                profile:
                    result.rows[0]
            });


        } catch (error) {

            console.error(
                "Profile fetch error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to fetch profile"
            });
        }
    }
);


/* =========================================================
   PROFILE - UPDATE
   ========================================================= */

app.put(
    "/api/profile",
    auth,
    async (req, res) => {

        try {

            const {
                full_name,
                phone,
                organization_name,
                location
            } = req.body;


            if (
                !full_name ||
                !full_name.trim()
            ) {

                return bad(
                    res,
                    "Full name is required"
                );
            }


            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET
                        full_name = $1,
                        phone = $2,
                        organization_name = $3,
                        location = $4
                    WHERE id = $5

                    RETURNING
                        id,
                        full_name,
                        email,
                        role,
                        phone,
                        organization_name,
                        location,
                        created_at
                    `,
                    [
                        full_name.trim(),
                        phone?.trim() || null,
                        organization_name?.trim() || null,
                        location?.trim() || null,
                        req.user.id
                    ]
                );


            if (
                result.rows.length === 0
            ) {

                return bad(
                    res,
                    "Profile not found",
                    404
                );
            }


            res.json({
                success: true,
                message:
                    "Profile updated successfully",
                profile:
                    result.rows[0]
            });


        } catch (error) {

            console.error(
                "Profile update error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to update profile"
            });
        }
    }
);


/* =========================================================
   DEVICES
   ========================================================= */

app.get(
    "/api/devices",
    auth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        owner_id,
                        device_code,
                        device_type,
                        last_seen_at,
                        rtc_synced,
                        status,
                        created_at
                    FROM devices
                    WHERE owner_id = $1
                    ORDER BY created_at DESC
                    `,
                    [req.user.id]
                );


            res.json({
                success: true,
                devices:
                    result.rows
            });


        } catch (error) {

            console.error(
                "Device fetch error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to fetch devices"
            });
        }
    }
);
/* =========================================================
   ESP32 DEVICE AUTHENTICATION
   ========================================================= */

async function deviceAuth(req, res, next) {

    try {

        const deviceCode =
            req.headers["x-device-code"];

        if (!deviceCode) {

            return res.status(401).json({
                success: false,
                message: "Device code is required"
            });
        }


        const result =
            await pool.query(
                `
                SELECT
                    d.*,
                    u.email AS owner_email,
                    u.full_name AS owner_name
                FROM devices d
                JOIN users u
                    ON d.owner_id = u.id
                WHERE d.device_code = $1
                `,
                [deviceCode]
            );


        if (result.rows.length === 0) {

            return res.status(401).json({
                success: false,
                message: "Invalid device code"
            });
        }


        req.device =
            result.rows[0];

        next();


    } catch (error) {

        console.error(
            "Device authentication error:",
            error
        );

        res.status(500).json({
            success: false,
            message:
                "Device authentication failed"
        });
    }
}


/* =========================================================
   REGISTER ESP32 DEVICE
   ========================================================= */

app.post(
    "/api/devices/register",
    auth,
    role("shopkeeper"),
    async (req, res) => {

        try {

            const {
                device_code
            } = req.body;


            if (!device_code) {

                return bad(
                    res,
                    "Device code is required"
                );
            }


            const cleanCode =
                String(device_code)
                    .trim();


            if (
                cleanCode.length < 4 ||
                cleanCode.length > 100
            ) {

                return bad(
                    res,
                    "Device code must contain 4 to 100 characters"
                );
            }


            const existing =
                await pool.query(
                    `
                    SELECT id
                    FROM devices
                    WHERE device_code = $1
                    `,
                    [cleanCode]
                );


            if (
                existing.rows.length > 0
            ) {

                return bad(
                    res,
                    "This device code is already registered",
                    409
                );
            }


            const result =
                await pool.query(
                    `
                    INSERT INTO devices
                    (
                        owner_id,
                        device_code,
                        device_type,
                        status,
                        rtc_synced
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        'ESP32',
                        'offline',
                        FALSE
                    )
                    RETURNING
                        id,
                        owner_id,
                        device_code,
                        device_type,
                        last_seen_at,
                        rtc_synced,
                        status,
                        created_at
                    `,
                    [
                        req.user.id,
                        cleanCode
                    ]
                );


            res.status(201).json({
                success: true,
                message:
                    "ESP32 device registered successfully",
                device:
                    result.rows[0]
            });


        } catch (error) {

            console.error(
                "Device registration error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to register ESP32 device"
            });
        }
    }
);


/* =========================================================
   ESP32 HEARTBEAT
   ========================================================= */

app.post(
    "/api/devices/heartbeat",
    deviceAuth,
    async (req, res) => {

        try {

            const rtcSynced =
                req.body.rtc_synced === true;


            const result =
                await pool.query(
                    `
                    UPDATE devices
                    SET
                        last_seen_at =
                            CURRENT_TIMESTAMP,
                        rtc_synced = $1,
                        status = 'online'
                    WHERE id = $2

                    RETURNING
                        id,
                        device_code,
                        device_type,
                        last_seen_at,
                        rtc_synced,
                        status
                    `,
                    [
                        rtcSynced,
                        req.device.id
                    ]
                );


            res.json({
                success: true,
                message:
                    "ESP32 heartbeat received",
                device:
                    result.rows[0]
            });


        } catch (error) {

            console.error(
                "Heartbeat error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to process device heartbeat"
            });
        }
    }
);


/* =========================================================
   GET FOOD FOR ESP32
   ========================================================= */

app.get(
    "/api/device/food",
    deviceAuth,
    async (req, res) => {

        try {

            /*
             * Automatically mark expired food as expired.
             */

            await pool.query(
                `
                UPDATE food_listings
                SET status = 'expired'
                WHERE donor_id = $1
                AND best_before <= CURRENT_TIMESTAMP
                AND status IN
                (
                    'available',
                    'requested',
                    'accepted'
                )
                `,
                [req.device.owner_id]
            );


            /*
             * Get the shopkeeper's active food.
             */

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        food_name,
                        quantity,
                        unit,
                        food_type,
                        prepared_at,
                        best_before,
                        description,
                        status,
                        created_at
                    FROM food_listings
                    WHERE donor_id = $1
                    AND status IN
                    (
                        'available',
                        'requested',
                        'accepted'
                    )
                    AND best_before > CURRENT_TIMESTAMP
                    ORDER BY best_before ASC
                    `,
                    [req.device.owner_id]
                );


            res.json({
                success: true,
                food:
                    result.rows
            });


        } catch (error) {

            console.error(
                "Device food fetch error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to fetch food for ESP32"
            });
        }
    }
);


/* =========================================================
   ESP32 DEVICE EVENT
   ========================================================= */

app.post(
    "/api/device/event",
    deviceAuth,
    async (req, res) => {

        try {

            const {
                food_id,
                event_type,
                message
            } = req.body;


            if (!event_type) {

                return bad(
                    res,
                    "Event type is required"
                );
            }


            let validFoodId =
                null;


            if (
                food_id !== undefined &&
                food_id !== null &&
                food_id !== ""
            ) {

                validFoodId =
                    Number(food_id);


                if (
                    !Number.isInteger(
                        validFoodId
                    ) ||
                    validFoodId <= 0
                ) {

                    return bad(
                        res,
                        "Invalid food ID"
                    );
                }


                /*
                 * Make sure the food belongs
                 * to this device owner.
                 */

                const foodCheck =
                    await pool.query(
                        `
                        SELECT id
                        FROM food_listings
                        WHERE id = $1
                        AND donor_id = $2
                        `,
                        [
                            validFoodId,
                            req.device.owner_id
                        ]
                    );


                if (
                    foodCheck.rows.length === 0
                ) {

                    return bad(
                        res,
                        "Food does not belong to this device owner",
                        403
                    );
                }
            }


            const result =
                await pool.query(
                    `
                    INSERT INTO device_events
                    (
                        device_id,
                        food_id,
                        event_type,
                        message
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4
                    )
                    RETURNING *
                    `,
                    [
                        req.device.id,
                        validFoodId,
                        String(event_type).trim(),
                        message
                            ? String(message).trim()
                            : null
                    ]
                );


            /*
             * A device event also means
             * that the device is alive.
             */

            await pool.query(
                `
                UPDATE devices
                SET
                    last_seen_at =
                        CURRENT_TIMESTAMP,
                    status = 'online'
                WHERE id = $1
                `,
                [req.device.id]
            );


            res.status(201).json({
                success: true,
                message:
                    "Device event recorded",
                event:
                    result.rows[0]
            });


        } catch (error) {

            console.error(
                "Device event error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to record device event"
            });
        }
    }
);


/* =========================================================
   DEVICE EVENTS - VIEW
   ========================================================= */

app.get(
    "/api/device/events",
    auth,
    role("shopkeeper"),
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        e.id,
                        e.device_id,
                        e.food_id,
                        e.event_type,
                        e.message,
                        e.created_at,
                        d.device_code,
                        f.food_name
                    FROM device_events e

                    JOIN devices d
                        ON e.device_id = d.id

                    LEFT JOIN food_listings f
                        ON e.food_id = f.id

                    WHERE d.owner_id = $1

                    ORDER BY
                        e.created_at DESC
                    `,
                    [req.user.id]
                );


            res.json({
                success: true,
                events:
                    result.rows
            });


        } catch (error) {

            console.error(
                "Device events fetch error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to fetch device events"
            });
        }
    }
);


/* =========================================================
   FRONTEND
   ========================================================= */

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "..",
                "index.html"
            )
        );
    }
);


/* =========================================================
   ERROR HANDLER
   ========================================================= */

app.use(
    (error, req, res, next) => {

        console.error(
            "Unhandled server error:",
            error
        );

        res.status(500).json({
            success: false,
            message:
                "Internal server error"
        });
    }
);


/* =========================================================
   START SERVER
   ========================================================= */

app.listen(
    PORT,
    () => {

        console.log(
            "===================================="
        );

        console.log(
            "FoodShare Backend Server"
        );

        console.log(
            "===================================="
        );

        console.log(
            `Server running on port ${PORT}`
        );
    }
);