const express = require('express');
const { ethers } = require('ethers');
const axios = require('axios');
const FormData = require('form-data');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const contractABI = require('./contractABI');

const app = express();
app.use(express.json());
app.use('/nft-images', express.static(path.join(__dirname, 'nft-images')));
app.use(express.static('public'));

// Environment variables validation
if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !process.env.DISCORD_REDIRECT_URI) {
    console.error('Missing required Discord environment variables:', {
        clientId: !!process.env.DISCORD_CLIENT_ID,
        clientSecret: !!process.env.DISCORD_CLIENT_SECRET,
        redirectUri: !!process.env.DISCORD_REDIRECT_URI
    });
    process.exit(1);
}

const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_API_KEY = process.env.PINATA_SECRET_API_KEY;
const CONTRACT_ADDRESS = '0xFf35268905302Ecf90b175E7277c59cFD471bBc3';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

// NFT Image Generation Function
const generateNFTImage = async (avatarUrl, userRoles) => {
    const canvasSize = 1000;
    const canvas = createCanvas(canvasSize, canvasSize);
    const ctx = canvas.getContext('2d');

    // Clear the canvas to ensure transparency
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Define roleTraits with outline colors and priorities
    const roleTraits = [
        { roleId: '1036887311436238858', outlineColor: 'rgba(200, 188, 244, 1)' },
        { roleId: '1073054714092073000', outlineColor: 'rgba(176, 156, 252, 1)' },
        { roleId: '1037873237159321612', outlineColor: 'rgba(136, 108, 252, 1)' },
        { roleId: '1046330093569593418', outlineColor: 'rgba(256, 140, 228, 1)' },
        { roleId: '1051562453495971941', outlineColor: 'rgba(184, 60, 124, 1)' },
        { roleId: '1144287729862049903', outlineColor: 'rgba(32, 188, 156, 1)' }
    ];

    // Set default outline color
    let outlineColor = 'black';

    // Check for the highest priority role the user has
    for (const trait of roleTraits) {
        if (userRoles.includes(trait.roleId)) {
            outlineColor = trait.outlineColor;
            break;
        }
    }

    // Fill the background with the outline color based on priority
    ctx.fillStyle = outlineColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Load the user's avatar image
    const avatarImage = await loadImage(avatarUrl);

    // Scale avatar proportionally
    const avatarMaxSize = 900;
    const aspectRatio = avatarImage.width / avatarImage.height;
    let avatarWidth, avatarHeight;

    if (aspectRatio > 1) {
        avatarWidth = avatarMaxSize;
        avatarHeight = avatarMaxSize / aspectRatio;
    } else {
        avatarHeight = avatarMaxSize;
        avatarWidth = avatarMaxSize * aspectRatio;
    }

    // Center the avatar
    const xOffset = (canvas.width - avatarWidth) / 2;
    const yOffset = (canvas.height - avatarHeight) / 2;

    // Draw the avatar image
    ctx.drawImage(avatarImage, xOffset, yOffset, avatarWidth, avatarHeight);

    return canvas.toBuffer('image/png');
};

// Save NFT Image Function
const saveNFTImage = (imageBuffer, userId) => {
    const dirPath = path.join(__dirname, 'nft-images');
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath);
    }
    const filePath = path.join(dirPath, `${userId}.png`);
    fs.writeFileSync(filePath, imageBuffer);
    return filePath;
};

console.log('Initializing provider and signer...');
const provider = new ethers.JsonRpcProvider(`https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`);
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

console.log('Contract address:', CONTRACT_ADDRESS);
console.log('ABI length:', contractABI.length);

let contract;
try {
    console.log('Initializing main contract...');
    contract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, signer);
    console.log('Contract initialized successfully');
} catch (error) {
    console.error('Error initializing main contract:', error);
}

app.get('/login', (req, res) => {
    const redirectUri = process.env.DISCORD_REDIRECT_URI;
    const authUrl = new URL('https://discord.com/api/oauth2/authorize');
    
    authUrl.searchParams.append('client_id', process.env.DISCORD_CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', 'identify guilds guilds.members.read');
    
    res.redirect(authUrl.toString());
});

app.get('/auth/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (code) {
        try {
            const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', 
                new URLSearchParams({
                    client_id: process.env.DISCORD_CLIENT_ID,
                    client_secret: process.env.DISCORD_CLIENT_SECRET,
                    code,
                    grant_type: 'authorization_code',
                    redirect_uri: process.env.DISCORD_REDIRECT_URI,
                    scope: 'identify guilds guilds.members.read',
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                }
            );

            const { access_token, token_type } = tokenResponse.data;

            const userResponse = await axios.get('https://discord.com/api/users/@me', {
                headers: { Authorization: `${token_type} ${access_token}` },
            });

            const guildMemberResponse = await axios.get(`https://discord.com/api/users/@me/guilds/${process.env.DISCORD_GUILD_ID}/member`, {
                headers: { Authorization: `${token_type} ${access_token}` },
            });

            const userData = userResponse.data;
            const userRoles = guildMemberResponse.data.roles;

            let avatarUrl;
            if (guildMemberResponse.data.avatar) {
                avatarUrl = `https://cdn.discordapp.com/guilds/${process.env.DISCORD_GUILD_ID}/users/${userData.id}/avatars/${guildMemberResponse.data.avatar}.png?size=1024`;
            } else {
                avatarUrl = userData.avatar 
                    ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png?size=1024`
                    : `https://cdn.discordapp.com/embed/avatars/${parseInt(userData.discriminator) % 5}.png`;
            }

            const nftImageBuffer = await generateNFTImage(avatarUrl, userRoles);
            const savedImagePath = saveNFTImage(nftImageBuffer, userData.id);

            // Debug logging
            console.log('Saved image path:', savedImagePath);
            console.log('User ID:', userData.id);
            console.log('Username:', userData.username);
            console.log('Avatar URL:', avatarUrl);

            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Your Discord NFT</title>
                    <script src="https://cdn.ethers.io/lib/ethers-5.7.2.umd.min.js"></script>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            padding: 20px;
                            background-color: #2c2f33;
                            color: white;
                        }
                        .nft-container {
                            margin: 20px 0;
                        }
                        .mint-button {
                            background-color: #7289da;
                            color: white;
                            border: none;
                            padding: 10px 20px;
                            border-radius: 5px;
                            cursor: pointer;
                            font-size: 16px;
                            margin: 10px;
                        }
                        .mint-button:hover {
                            background-color: #5b6eae;
                        }
                        .mint-button:disabled {
                            background-color: #4a5264;
                            cursor: not-allowed;
                        }
                        .wallet-container {
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            gap: 10px;
                            margin: 20px 0;
                        }
                        .wallet-address {
                            font-family: monospace;
                            color: #7289da;
                        }
                    </style>
                </head>
                <body>
                    <h1>Welcome, ${userData.username}!</h1>
                    <div class="nft-container">
                        <img src="/nft-images/${userData.id}.png" alt="Your NFT" style="max-width: 1000px;"/>
                    </div>
                    <div class="wallet-container">
                        <button class="mint-button" id="connectButton" onclick="toggleWallet()">Connect Wallet</button>
                        <div id="walletAddress" class="wallet-address"></div>
                    </div>
                    <button class="mint-button" id="mintButton" onclick="mintNFT()" style="display: none;">Mint NFT</button>

                                        <script>
                        let userAddress = null;
                        let signer = null;
                        let mintPrice = null;

                        async function checkAndSwitchNetwork() {
                            try {
                                await window.ethereum.request({
                                    method: 'wallet_switchEthereumChain',
                                    params: [{ chainId: '0xaa36a7' }], // Sepolia chainId
                                });
                            } catch (switchError) {
                                if (switchError.code === 4902) {
                                    try {
                                        await window.ethereum.request({
                                            method: 'wallet_addEthereumChain',
                                            params: [{
                                                chainId: '0xaa36a7',
                                                chainName: 'Sepolia Test Network',
                                                nativeCurrency: {
                                                    name: 'ETH',
                                                    symbol: 'ETH',
                                                    decimals: 18
                                                },
                                                rpcUrls: [`https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`],
                                                blockExplorerUrls: ['https://sepolia.etherscan.io']
                                            }]
                                        });
                                    } catch (addError) {
                                        throw new Error('Could not add Sepolia network to MetaMask');
                                    }
                                }
                                throw new Error('Could not switch to Sepolia network');
                            }
                        }

                        async function connectWallet() {
                            if (typeof window.ethereum === 'undefined') {
                                alert('Please install MetaMask to mint NFTs!');
                                return false;
                            }

                            try {
                                // Request account access first
                                await window.ethereum.request({ 
                                    method: 'eth_requestAccounts' 
                                });

                                // Switch to Sepolia
                                await checkAndSwitchNetwork();

                                // Now create the provider
                                const provider = new ethers.providers.Web3Provider(window.ethereum);
                                signer = await provider.getSigner();
                                userAddress = await signer.getAddress();
                                
                                document.getElementById('connectButton').textContent = 'Disconnect Wallet';
                                document.getElementById('mintButton').style.display = 'block';
                                document.getElementById('walletAddress').textContent = 'Connected: ' + userAddress.slice(0,6) + '...' + userAddress.slice(-4);
                                
                                await checkBalanceAndPrice();
                                return true;
                            } catch (error) {
                                console.error('Error:', error);
                                alert('Failed to connect wallet: ' + error.message);
                                return false;
                            }
                        }

                        async function disconnectWallet() {
                            userAddress = null;
                            signer = null;
                            document.getElementById('connectButton').textContent = 'Connect Wallet';
                            document.getElementById('mintButton').style.display = 'none';
                            document.getElementById('walletAddress').textContent = '';
                        }

                        async function toggleWallet() {
                            if (userAddress) {
                                await disconnectWallet();
                            } else {
                                await connectWallet();
                            }
                        }

                        async function checkBalanceAndPrice() {
                            const response = await fetch('/mint', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                    discordUsername: "${userData.username}",
                                    imageUrl: "/nft-images/${userData.id}.png",
                                    walletAddress: userAddress,
                                    checkOnly: true
                                })
                            });

                            const data = await response.json();
                            if (data.success) {
                                mintPrice = data.price;
                                const provider = new ethers.providers.Web3Provider(window.ethereum);
                                const balance = await provider.getBalance(userAddress);
                                const balanceInEth = ethers.formatEther(balance);

                                if (parseFloat(balanceInEth) < parseFloat(mintPrice)) {
                                    alert('Insufficient Sepolia ETH. You need at least ' + mintPrice + ' ETH to mint. Your balance: ' + balanceInEth + ' ETH');
                                    document.getElementById('mintButton').disabled = true;
                                    return false;
                                }
                                document.getElementById('mintButton').disabled = false;
                                return true;
                            }
                            return false;
                        }

                        async function mintNFT() {
                            try {
                                const provider = new ethers.providers.Web3Provider(window.ethereum);
                                const signer = await provider.getSigner();
                                const contract = new ethers.Contract("${CONTRACT_ADDRESS}", ${JSON.stringify(contractABI)}, signer);

                                const approveConfirm = confirm("Do you want to mint this NFT for " + mintPrice + " Sepolia ETH?");
                                if (!approveConfirm) return;

                                const tx = await contract.mintOwnNFT({ value: ethers.parseEther(mintPrice) });
                                alert('Please wait while your transaction is being processed...');
                                await tx.wait();
                                
                                alert('NFT minted successfully!');
                                document.getElementById('mintButton').style.display = 'none';
                            } catch (error) {
                                console.error('Error:', error);
                                alert('Error minting NFT: ' + error.message);
                            }
                        }
                    </script>
                </body>
                </html>
            `);
        } catch (error) {
            console.error('Error during OAuth flow:', error.response?.data || error.message);
            res.status(500).send('Authentication failed. Please try again.');
        }
    } else {
        res.status(400).send('No code provided');
    }
});

app.post('/mint', async (req, res) => {
    try {
        const { discordUsername, imageUrl, walletAddress, checkOnly } = req.body;
        
        if (!discordUsername || !imageUrl || !walletAddress) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required parameters' 
            });
        }

        // Get the mint price first
        const currentTime = Math.floor(Date.now() / 1000);
        const publicMintingEnd = await contract.PUBLIC_MINTING_END();
        
        let mintPrice;
        if (currentTime <= Number(publicMintingEnd)) {
            mintPrice = await contract.INITIAL_MINT_PRICE();
        } else {
            const userRole = await getUserHighestRole(discordUsername);
            const roleEnum = getRoleEnum(userRole);
            mintPrice = await contract.rolePrices(roleEnum);
        }

        // If this is just a check, return the price
        if (checkOnly) {
            return res.json({
                success: true,
                price: ethers.formatEther(mintPrice)
            });
        }

        // Otherwise proceed with IPFS upload and full mint preparation
        const imagePath = path.join(__dirname, 'nft-images', path.basename(imageUrl));
        console.log('Reading image from:', imagePath);
        const imageBuffer = fs.readFileSync(imagePath);
        console.log('Image buffer size:', imageBuffer.length);

        const formData = new FormData();
        formData.append('file', imageBuffer, {
            filename: path.basename(imageUrl),
            contentType: 'image/png'
        });

        console.log('Uploading to Pinata...');
        const resFile = await axios.post("https://api.pinata.cloud/pinning/pinFileToIPFS", formData, {
            maxBodyLength: "Infinity",
            headers: {
                'Content-Type': `multipart/form-data; boundary=${formData._boundary}`,
                'pinata_api_key': PINATA_API_KEY,
                'pinata_secret_api_key': PINATA_SECRET_API_KEY
            }
        });

        const imgHash = resFile.data.IpfsHash;
        console.log('IPFS Image Hash:', imgHash);
        
        const metadata = {
            name: `Profile Picture NFT for ${discordUsername}`,
            description: `NFT minted from Discord profile picture`,
            image: `ipfs://${imgHash}`,
            attributes: []
        };

        console.log('Uploading metadata to Pinata...');
        const resMetadata = await axios.post("https://api.pinata.cloud/pinning/pinJSONToIPFS", metadata, {
            headers: {
                'Content-Type': 'application/json',
                'pinata_api_key': PINATA_API_KEY,
                'pinata_secret_api_key': PINATA_SECRET_API_KEY
            }
        });

        const metadataHash = resMetadata.data.IpfsHash;
        console.log('IPFS Metadata Hash:', metadataHash);
        console.log('Full metadata:', metadata);

        res.json({ 
            success: true, 
            price: ethers.formatEther(mintPrice),
            metadataHash,
            contractAddress: CONTRACT_ADDRESS,
            imageUrl: `ipfs://${imgHash}`,
            metadataUrl: `ipfs://${metadataHash}`
        });
    } catch (error) {
        console.error('Detailed error in mint:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error preparing NFT mint',
            error: error.message
        });
    }
});

async function getUserHighestRole(discordUsername) {
    return 'Newbie';
}

function getRoleEnum(role) {
    const roleMap = {
        'newbie': 0,
        'fullaccess': 1,
        'nads': 2,
        'nadog': 3,
        'mon': 4,
        'communityteam': 5
    };
    return roleMap[role.toLowerCase()] || 0;
}

app.get('/', (req, res) => {
    res.send(`
        <h1>NFT Minting API</h1>
        <p>Available endpoints:</p>
        <ul>
            <li>GET /login - Start Discord OAuth2 flow</li>
            <li>GET /auth/discord/callback - Discord OAuth2 callback</li>
            <li>POST /mint - Mint NFT</li>
        </ul>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    try {
        const network = await provider.getNetwork();
        console.log('Provider network:', network.name);
    } catch (error) {
        console.error('Error during startup:', error);
    }
});
