import React, { useState, useEffect, useRef, useCallback } from 'react'; 
import { Container, Button, Table, Form, Alert, Modal, Row, Col, Dropdown, ButtonGroup } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faUserCog, 
  faUserPlus, 
  faUsers, 
  faSignInAlt, 
  faShoppingCart, 
  faExchangeAlt,
  faUser,               // ✅ Added missing icons
  faUserTie,
  faChartLine,
  faDollarSign,
  faChartBar,
  faHourglassHalf,
  faBullseye,
  faMapMarkerAlt
} from '@fortawesome/free-solid-svg-icons'; 
import './css/landing.css';


const Landing = () => {
  /********************************************************
   *           STATES & REGISTRATION SETUP              *
   ********************************************************/
  const [users, setUsers] = useState([]); // Initially an empty array
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  // Use checkboxes to select 1–3 users
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [openTrades, setOpenTrades] = useState([]);  // Open trades array from backend

  // New state to toggle the trades dashboard display
  const [showTradesDashboard, setShowTradesDashboard] = useState(false);

  const [formData, setFormData] = useState({
    username: "",
    broker: "Angel",
    api_key: "",
    totp_token: "",
    symbol: "",  // used for trade symbol
    default_quantity: "",
  });
  
  // Action type: 'buy' or 'sell'
  const [actionType, setActionType] = useState(null);
  const [showStopLossForm, setShowStopLossForm] = useState(false);

  // Thresholds and entry price
  const [buyThreshold, setBuyThreshold] = useState(100);
  const [sellThreshold, setSellThreshold] = useState(120);
  const [entryPrice, setEntryPrice] = useState(null);

  // Stop-loss and condition settings for BUY
  const [stopLossType, setStopLossType] = useState('Fixed'); // Options: "Fixed", "Percentage", "Points"
  const [stopLossValue, setStopLossValue] = useState(95);
  const [buyConditionType, setBuyConditionType] = useState('Fixed Value'); // Options: "Fixed Value", "Percentage", "Points"
  const [buyConditionValue, setBuyConditionValue] = useState(0);
  const [pointsCondition, setPointsCondition] = useState(0);
  const basePriceRef = useRef(null);

  // Stop-gain and condition settings for SELL
  const [sellConditionType, setSellConditionType] = useState('Fixed Value'); // Options: "Fixed Value", "Percentage", "Points"
  const [sellConditionValue, setSellConditionValue] = useState(0);

  // LTP (Last Traded Price) settings
  const [exchange, setExchange] = useState("NSE");
  const [ltpSymbol, setLtpSymbol] = useState("");
  const [symbolToken, setSymbolToken] = useState("");
  const [ltpPrice, setLtpPrice] = useState(null);
  const [loadingLtp, setLoadingLtp] = useState(false);
  const [showOhlcForm, setShowOhlcForm] = useState(false);
  const [showFullForm, setShowFullForm] = useState(false);

  const [ohlcData, setOhlcData] = useState(null);
  const [fullData, setFullData] = useState(null);
  
  const [loadingOhlc, setLoadingOhlc] = useState(false);
  const [loadingFull, setLoadingFull] = useState(false);
  
  /********************************************************
   *                 API FUNCTIONS                      *
   ********************************************************/
  const fetchLtp = async () => {
    if (!ltpSymbol) {
      alert("Please enter a stock symbol.");
      return;
    }
    setLoadingLtp(true);
    try {
      const response = await fetch(`https://mtb-2.onrender.com/api/fetch_ltp?exchange=${exchange}&symbol=${ltpSymbol}&token=${symbolToken}`);
      const data = await response.json();
      if (response.status) {
        setLtpPrice(data.ltp);
      } else {
        setLtpPrice(null);
        alert("Failed to fetch LTP. Please check the symbol.");
      }
    } catch (error) {
      console.error("Error fetching LTP:", error);
      alert("Server error. Try again later.");
    } finally {
      setLoadingLtp(false);
    }
  };

  const fetchOhlc = async () => {
    if (!ltpSymbol) {
      alert("Please enter a stock symbol.");
      return;
    }
    setLoadingOhlc(true);
    try {
      const response = await fetch(`https://mtb-2.onrender.com/api/fetch_ohlc?exchange=${exchange}&symbol=${ltpSymbol}&token=${symbolToken}`);
      const data = await response.json();
      if (data.status) {
        setOhlcData(data.ohlc);
        // Display Open, High, Low, Close prices
        console.log("OHLC Data:", data.ohlc);
      } else {
        setOhlcData(null);
        alert("Failed to fetch OHLC data. Please check the symbol.");
      }
    } catch (error) {
      console.error("Error fetching OHLC:", error);
      alert("Server error. Try again later.");
    } finally {
      setLoadingOhlc(false);
    }
  };
  
  const fetchFullData = async () => {
    if (!ltpSymbol) {
      alert("Please enter a stock symbol.");
      return;
    }
    setLoadingFull(true);
    try {
      const response = await fetch(`https://mtb-2.onrender.com/api/fetch_full?exchange=${exchange}&symbol=${ltpSymbol}&token=${symbolToken}`);
      const data = await response.json();
      if (data.status) {
        setFullData(data.full_data);
        // Display the Full Mode data (LTP, Open, High, Low, Close, etc.)
        console.log("Full Data:", data.full_data);
      } else {
        setFullData(null);
        alert("Failed to fetch Full data. Please check the symbol.");
      }
    } catch (error) {
      console.error("Error fetching Full data:", error);
      alert("Server error. Try again later.");
    } finally {
      setLoadingFull(false);
    }
  };
  
  const fetchTrades = async () => {
    try {
      const response = await fetch("https://ramdoot.onrender.com/api/get_trades");
      if (!response.ok) {
        throw new Error("Failed to fetch trades");
      }
      const data = await response.json();
      
      // ✅ Ensure user role is included
      const updatedTrades = data.trades.map(trade => ({
        ...trade,
        user_role: trade.user_role || "Trader", // Default role if missing
      }));
  
      setOpenTrades(updatedTrades);
    } catch (error) {
      console.error("Error fetching trades:", error);
    }
  };
  

  const UserActionsDropdown = ({ setShowRegisterModal, setShowUsers, showUsers }) => {
    return (
      <Dropdown as={ButtonGroup}>
        {/* Main Icon Button */}
        <Dropdown.Toggle variant="primary" id="dropdown-basic" className="user-actions-dropdown">
          <FontAwesomeIcon icon={faUserCog} />
        </Dropdown.Toggle>
  
        {/* Dropdown Menu */}
        <Dropdown.Menu>
          <Dropdown.Item onClick={() => setShowRegisterModal(true)}>
            <FontAwesomeIcon icon={faUserPlus} className="me-2" /> Register
          </Dropdown.Item>
          <Dropdown.Item onClick={() => setShowUsers(!showUsers)}>
            <FontAwesomeIcon icon={faUsers} className="me-2" /> View Users
          </Dropdown.Item>
          <Dropdown.Item onClick={() => window.open('https://www.angelone.in/login/?redirectUrl=account', '_blank')}>
            <FontAwesomeIcon icon={faSignInAlt} className="me-2" /> Angel Login
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>
    );
  };

  // ------------------------------
  // Fetch registered users on component mount
  // ------------------------------
  const fetchUsers = async () => {
    try {
      const response = await fetch("https://ramdoot.onrender.com/api/get_users", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
  
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
  
      const data = await response.json();
      console.log("Fetched users:", data.users);
      setUsers(data.users);
    } catch (error) {
      console.error("Error fetching users:", error);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);


  // Registration submit handler
  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    console.log("Submitting user:", formData);
  
    try {
      const response = await fetch("https://ramdoot.onrender.com/api/register_user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: formData.username,
          password: formData.password,  // Added password field
          broker: formData.broker,
          api_key: formData.api_key,
          totp_token: formData.totp_token,
          default_quantity: parseInt(formData.default_quantity, 10) || 1,
        }),
      });
  
      const data = await response.json();
      console.log("API Response:", data);
  
      if (response.ok) {
        setMessage({ text: "User registered successfully!", type: "success" });
        fetchUsers(); // Refresh user list
        setFormData({
          username: "",
          password: "",  // Added password reset
          broker: "Angel",
          api_key: "",
          totp_token: "",
          default_quantity: "",
        });
      } else {
        setMessage({ text: data.detail || "Registration failed", type: "danger" });
      }
    } catch (error) {
      console.error("Error registering user:", error);
      setMessage({ text: "Server error. Try again later.", type: "danger" });
    }
  };
  

  // Delete user handler
  const handleDeleteUser = async (username) => {
    console.log(`Deleting user: ${username}`);
    try {
      const response = await fetch(`https://ramdoot.onrender.com/api/delete_user/${username}`, {
        method: "DELETE"
      });
      const data = await response.json();
      console.log("API Response:", data);
      if (response.ok) {
        setUsers(users.filter(user => user.username !== username));
        setMessage({ text: "User deleted successfully!", type: "success" });
      } else {
        setMessage({ text: data.detail || "Failed to delete user", type: "danger" });
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      setMessage({ text: "Server error. Try again later.", type: "danger" });
    }
  };
  const handleStopLossSubmission = async (e) => {
    e.preventDefault();
    
    if (selectedUsers.length === 0 || selectedUsers.length > 3) {
      setMessage({ text: "Please select 1 to 3 users for this trade.", type: "danger" });
      return;
    }
  
    const tradeData = {
      users: selectedUsers,
      symbol: formData.symbol,
      actionType: actionType,
      stopLossType: stopLossType,
      stopLossValue: stopLossValue,
      buyThreshold: actionType === 'buy' ? buyThreshold : null,
      sellThreshold: actionType === 'sell' ? sellThreshold : null,
      buyConditionType: actionType === 'buy' ? buyConditionType : null,
      buyConditionValue: actionType === 'buy' ? buyConditionValue : null,
      sellConditionType: actionType === 'sell' ? sellConditionType : null,
      sellConditionValue: actionType === 'sell' ? sellConditionValue : null,
      pointsCondition: pointsCondition
    };
  
    try {
      const response = await fetch(actionType === 'buy' ? 'https://ramdoot.onrender.com/api/buy_trade' : 'https://ramdoot.onrender.com/api/sell_trade', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tradeData),
      });
  
      const data = await response.json();
  
      if (response.ok) {
        setMessage({ text: `Trade ${actionType === 'buy' ? 'buy' : 'sell'} order placed successfully!`, type: "success" });
        // Optionally, refresh the trades list or reset form here
        setShowStopLossForm(false);
        fetchTrades();
      } else {
        setMessage({ text: data.detail || "Failed to place trade order", type: "danger" });
      }
    } catch (error) {
      console.error("Error placing trade order:", error);
      setMessage({ text: "Server error. Try again later.", type: "danger" });
    }
  };
  
  const AdvancedChart = ({ symbol, openTrades }) => {
    const chartContainerRef = useRef(null);
    const tvWidgetRef = useRef(null);
  
    useEffect(() => {
      loadTradingViewScript(() => {
        if (!window.TradingView) return;
  
        tvWidgetRef.current = new window.TradingView.widget({
          autosize: true,
          symbol: symbol || "NASDAQ:AAPL",
          interval: "5",
          container_id: "advanced_chart_container",
          datafeed: window.TradingView.defaultDatafeed, // ✅ Gets data from TradingView
          library_path: "/charting_library/",
          locale: "en",
          disabled_features: ["header_saveload"],
          enabled_features: [],
          onChartReady: () => console.log("Advanced chart is ready"),
        });
      });
    }, [symbol]);
  
    const updateMarkers = (trades) => {
      if (!tvWidgetRef.current) return;
    
      // ✅ Ensure the widget is fully initialized
      if (typeof tvWidgetRef.current.on !== "function") {
        console.error("TradingView widget is not initialized properly.");
        return;
      }
    
      tvWidgetRef.current.on("chart_ready", () => {
        const chart = tvWidgetRef.current.chart(); // ✅ Correct way to access the chart
        const currentTime = Math.floor(Date.now() / 1000); // UNIX timestamp
    
        let priceOffset = {}; // Track how many trades exist at a given price
    
        trades.forEach((trade) => {
          const basePrice = trade.entry_price;
    
          // Offset price if multiple trades exist at the same level
          if (!priceOffset[basePrice]) {
            priceOffset[basePrice] = 0;
          } else {
            priceOffset[basePrice] += 0.5; // Offset by 0.5 points
          }
    
          // 🎨 Assign unique icons & colors for users
          const userIcons = {
            "John": { icon: "👨‍💼", color: "🔵" },  // Businessman icon (Blue)
            "Alice": { icon: "👩‍💼", color: "🟢" },  // Businesswoman icon (Green)
            "Bob": { icon: "🧑‍💻", color: "🟠" }   // Developer icon (Orange)
          };
    
          // Get user icon & color (default to 🧑‍💻 and ⚪ if not found)
          const userData = userIcons[trade.username] || { icon: "🧑‍💻", color: "⚪" };
    
          // ✅ Add marker with hover effect showing username, role, and color icon
          chart.createShape(
            { time: currentTime, price: basePrice + priceOffset[basePrice] },
            {
              shape: trade.position_type === "LONG" ? "arrow_up" : "arrow_down",
              text: `${userData.color} ${userData.icon} ${trade.username}\n(${trade.user_role})`, // ✅ Colored User Icon + Name + Role (Hover Effect)
              color: trade.position_type === "LONG" ? "green" : "red",
              disableUndo: true
            }
          );
        });
      });
    };
    
  
    useEffect(() => {
      if (tvWidgetRef.current) {
        updateMarkers(openTrades); // ✅ Updates chart when trades change
      }
    }, [openTrades]);
  
    return <div id="advanced_chart_container" ref={chartContainerRef} style={{ height: "500px", width: "100%" }}></div>;
  };
  
  const loadTradingViewScript = (callback) => {
    if (window.TradingView) {
      callback();
      return;
    }
  
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = callback; // Ensure script loads before calling TradingView
    document.body.appendChild(script);
  };
  

  /********************************************************
   *                     RENDER (JSX)                     *
   ********************************************************/
  return (
    <>
      <Container className="mt-4">
        {/* Top-right action buttons */}
        <Row className="justify-content-end mb-3" style={{ position: "absolute", top: "9%", right: "10px", zIndex: "1000" }}>
          <Col xs="auto">
            <UserActionsDropdown 
              setShowRegisterModal={setShowRegisterModal} 
              setShowUsers={setShowUsers} 
              showUsers={showUsers} 
            />
          </Col>
        </Row>

        {/* Registered Users Table */}
        {/* ===================== Registered Users Table ===================== */}
        {showUsers && (
          <Container className="users-table-container mb-5">
            <h3 className="text-center mb-4 text-primary">
              <FontAwesomeIcon icon={faUsers} className="me-2" /> Registered Users
            </h3>
            <div className="table-responsive">
              <Table striped bordered hover className="users-table shadow-sm">
                <thead>
                  <tr>
                    <th className="table-header bg-primary text-white">#</th>
                    <th className="table-header bg-success text-white">Username</th>
                    <th className="table-header bg-info text-white">Role</th>
                    <th className="table-header bg-warning text-dark">Broker</th>
                    <th className="table-header bg-danger text-white">Default Quantity</th>
                    <th className="table-header bg-dark text-white">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length > 0 ? (
                    users.map((user, index) => (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        <td>{user.username}</td>
                        <td>{user.role || "Trader"}</td>
                        <td>{user.broker}</td> {/* Correctly display the broker */}
                        <td>{user.default_quantity}</td> {/* Display default quantity */}
                        <td>
                          <Button variant="danger" size="sm" onClick={() => handleDeleteUser(user.username)}>
                            ❌ Delete
                          </Button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6" className="text-muted text-center">No registered users found.</td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          </Container>
        )}

        {/* ===================== Active Trades Table ===================== */}
        {showTradesDashboard && (
          <>
            <Container className="mt-5 p-4 traders-table-container shadow-lg rounded bg-white">
              <h3 className="text-center mb-4 text-dark fw-bold">
                <FontAwesomeIcon icon={faExchangeAlt} className="me-2 text-primary" /> Active Trades
              </h3>
              <div className="table-responsive">
                <Table striped bordered hover className="traders-table shadow-sm">
                <thead className="text-center">
                    <tr>
                      <th>#</th>
                      <th className="bg-primary text-white">
                        <FontAwesomeIcon icon={faUser} /> Username
                      </th>
                      <th className="bg-success text-white">
                        <FontAwesomeIcon icon={faUserTie} /> Role
                      </th>
                      <th className="bg-info text-white">
                        <FontAwesomeIcon icon={faChartLine} /> Symbol
                      </th>
                      <th className="bg-dark text-white">
                        <FontAwesomeIcon icon={faDollarSign} /> Entry Price
                      </th>
                      <th className="bg-danger text-white">
                        <FontAwesomeIcon icon={faChartBar} /> Threshold
                      </th>
                      <th className="bg-secondary text-white">
                        <FontAwesomeIcon icon={faHourglassHalf} /> Exit Type
                      </th>
                      <th className="bg-primary text-white">
                        <FontAwesomeIcon icon={faBullseye} /> Exit Value
                      </th>
                      <th className="bg-warning text-dark">
                        <FontAwesomeIcon icon={faMapMarkerAlt} /> Position
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {openTrades.length > 0 ? (
                      openTrades.map((trade, index) => (
                        <tr key={index} className="align-middle text-center">
                          <td><strong className="text-secondary">{index + 1}</strong></td>
                          <td className="fw-bold text-warning">{trade.username}</td>
                          <td>
                            <span className={`badge ${trade.user_role === "Admin" ? "bg-danger" : "bg-secondary"}`}>
                              {trade.user_role}
                            </span>
                          </td>
                          <td className="text-primary fw-bold">{trade.symbol}</td>
                          <td className="text-success fw-bold">₹{trade.entry_price}</td>
                          <td className="text-danger fw-bold">{trade.position_type === "LONG" ? trade.buy_threshold : trade.sell_threshold}</td>
                          <td className="text-warning">{trade.exit_condition_type}</td>
                          <td className="text-info">{trade.exit_condition_value}</td>
                          <td>
                            <span className={`badge ${trade.position_type === "LONG" ? "bg-success" : "bg-danger"}`}>
                              {trade.position_type === "LONG" ? "🔼 Buy" : "🔽 Sell"}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="9" className="text-muted text-center">No active trades found.</td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </div>
            </Container>

            {/* Add AdvancedChart below the table with margin for spacing */}
            <Container className="mt-5 p-4 bg-light rounded shadow-lg">
              <h4 className="text-center mb-3 text-dark fw-bold">
                📊 Live Chart with Open Trades
              </h4>
              <AdvancedChart symbol={formData.symbol} openTrades={openTrades} />
            </Container>
          </>
        )}


        {/* Trading Action Buttons */}
        <Row className="justify-content-center mb-3">
          <Col xs="auto">
            <Button onClick={() => window.open('https://www.angelone.in/trade/markets/equity/overview', '_blank')} className="gradient-button btn-market">
              Market Overview
            </Button>
          </Col>
          <Col xs="auto">
            <Button onClick={() => window.open('https://www.angelone.in/trade/indices/indian', '_blank')} className="gradient-button btn-indices">
              Indices
            </Button>
          </Col>
          <Col xs="auto">
            <Button onClick={() => window.open('https://www.angelone.in/trade/watchlist/chart', '_blank')} className="gradient-button btn-chart">
              Chart
            </Button>
          </Col>
          <Col xs="auto">
            <Button onClick={() => window.open('https://www.angelone.in/trade/watchlist/option-chain', '_blank')} className="gradient-button btn-option">
              Option Chain
            </Button>
          </Col>
          <Col xs="auto">
            <Button onClick={fetchLtp} className="gradient-button btn-ltp">Fetch LTP</Button>
          </Col>
          <Col xs="auto">
            <Button onClick={() => { setShowTradesDashboard(!showTradesDashboard); fetchTrades(); }} className="gradient-button btn-trades">
              Trades Dashboard
            </Button>
          </Col>
        </Row>

        {/* LTP Form */}
        <Container className="ltp-container">
          <h4 className="text-primary">🔍 Live Fetch LTP</h4>
          <Form onSubmit={(e) => { e.preventDefault(); fetchLtp(); }}>
            <Row className="mb-3">
              <Col md={3}>
                <Form.Group controlId="exchange">
                  <Form.Label>Select Exchange</Form.Label>
                  <Form.Select value={exchange} onChange={(e) => setExchange(e.target.value)}>
                    <option value="NSE">NSE</option>
                    <option value="BSE">BSE</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group controlId="ltpSymbol">
                  <Form.Label>Enter Stock Symbol</Form.Label>
                  <Form.Control type="text" placeholder="e.g. RELIANCE" value={ltpSymbol} onChange={(e) => setLtpSymbol(e.target.value)} required />
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group controlId="symbolToken">
                  <Form.Label>Enter Symbol Token (Optional)</Form.Label>
                  <Form.Control type="text" placeholder="e.g. 3045" value={symbolToken} onChange={(e) => setSymbolToken(e.target.value)} />
                </Form.Group>
              </Col>
              <Col md={2}>
                <Button type="submit" variant="primary" className="mt-4">Fetch LTP</Button>
              </Col>
            </Row>
          </Form>
          {loadingLtp && <p>Loading...</p>}
          {ltpPrice !== null && (
            <Alert variant="success">
              📈 Latest Price of <strong>{ltpSymbol}</strong>: ₹{ltpPrice}
            </Alert>
          )}
        </Container>


      {/* Button to Toggle OHLC Form */}
      <Button variant="secondary" onClick={() => setShowOhlcForm(!showOhlcForm)} className="mt-4">
        {showOhlcForm ? 'Hide OHLC Form' : 'Show OHLC Form'}
      </Button>

          {/* OHLC Form (Conditional Rendering) */}
          {showOhlcForm && (
            <Container className="ltp-container mt-4">
              <h4 className="text-primary">📉 Fetch OHLC Data</h4>
              <Form onSubmit={(e) => { e.preventDefault(); fetchOhlc(); }}>
                <Row className="mb-3">
                  <Col md={3}>
                    <Form.Group controlId="ohlcExchange">
                      <Form.Label>Select Exchange</Form.Label>
                      <Form.Select value={exchange} onChange={(e) => setExchange(e.target.value)}>
                        <option value="NSE">NSE</option>
                        <option value="BSE">BSE</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col md={3}>
                    <Form.Group controlId="ohlcSymbol">
                      <Form.Label>Enter Stock Symbol</Form.Label>
                      <Form.Control type="text" placeholder="e.g. RELIANCE" value={ltpSymbol} onChange={(e) => setLtpSymbol(e.target.value)} required />
                    </Form.Group>
                  </Col>
                  <Col md={3}>
                    <Form.Group controlId="ohlcSymbolToken">
                      <Form.Label>Enter Symbol Token (Optional)</Form.Label>
                      <Form.Control type="text" placeholder="e.g. 3045" value={symbolToken} onChange={(e) => setSymbolToken(e.target.value)} />
                    </Form.Group>
                  </Col>
                  <Col md={2}>
                    <Button type="submit" variant="secondary" className="mt-4">Fetch OHLC</Button>
                  </Col>
                </Row>
              </Form>
              {loadingOhlc && <p>Loading...</p>}
              {ohlcData && (
                <Alert variant="info">
                  <strong>OHLC Data for {ltpSymbol}:</strong><br />
                  Open: ₹{ohlcData.open} <br />
                  High: ₹{ohlcData.high} <br />
                  Low: ₹{ohlcData.low} <br />
                  Close: ₹{ohlcData.close}
                </Alert>
              )}
            </Container>
          )}

          {/* Button to Toggle Full Mode Form */}
          <Button variant="success" onClick={() => setShowFullForm(!showFullForm)} className="mt-4">
            {showFullForm ? 'Hide Full Mode Form' : 'Show Full Mode Form'}
          </Button>

          {/* Full Mode Form (Conditional Rendering) */}
          {showFullForm && (
            <Container className="ltp-container mt-4">
              <h4 className="text-primary">📊 Fetch Full Data</h4>
              <Form onSubmit={(e) => { e.preventDefault(); fetchFullData(); }}>
                <Row className="mb-3">
                  <Col md={3}>
                    <Form.Group controlId="fullModeExchange">
                      <Form.Label>Select Exchange</Form.Label>
                      <Form.Select value={exchange} onChange={(e) => setExchange(e.target.value)}>
                        <option value="NSE">NSE</option>
                        <option value="BSE">BSE</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col md={3}>
                    <Form.Group controlId="fullModeSymbol">
                      <Form.Label>Enter Stock Symbol</Form.Label>
                      <Form.Control type="text" placeholder="e.g. RELIANCE" value={ltpSymbol} onChange={(e) => setLtpSymbol(e.target.value)} required />
                    </Form.Group>
                  </Col>
                  <Col md={3}>
                    <Form.Group controlId="fullModeSymbolToken">
                      <Form.Label>Enter Symbol Token (Optional)</Form.Label>
                      <Form.Control type="text" placeholder="e.g. 3045" value={symbolToken} onChange={(e) => setSymbolToken(e.target.value)} />
                    </Form.Group>
                  </Col>
                  <Col md={2}>
                    <Button type="submit" variant="success" className="mt-4">Fetch Full Data</Button>
                  </Col>
                </Row>
              </Form>
              {loadingFull && <p>Loading...</p>}
              {fullData && (
                <Alert variant="warning">
                  <strong>Full Data for {ltpSymbol}:</strong><br />
                  LTP: ₹{fullData.ltp} <br />
                  Open: ₹{fullData.open} <br />
                  High: ₹{fullData.high} <br />
                  Low: ₹{fullData.low} <br />
                  Close: ₹{fullData.close} <br />
                  Volume: {fullData.volume} <br />
                  {/* Add any other data you need */}
                </Alert>
              )}
            </Container>
          )}

        {/* Buy/Sell Buttons */}
        <Row className="justify-content-center mb-3">
          <Col xs="auto">
            <Button 
              onClick={() => { 
                setActionType('buy'); 
                setShowStopLossForm(true); 
              }} 
              className="gradient-button btn-buy"
              style={{ backgroundColor: '#007BA7', borderColor: '#007BA7', color: 'white' }}
            >
              <FontAwesomeIcon icon={faShoppingCart} /> Execute Buy with Stop-Loss
            </Button>
          </Col>
          <Col xs="auto">
            <Button 
              onClick={() => { 
                setActionType('sell'); 
                setShowStopLossForm(true); 
              }} 
              className="gradient-button btn-sell"
              style={{ backgroundColor: '#B22222', borderColor: '#B22222', color: 'white' }}
            >
              <FontAwesomeIcon icon={faExchangeAlt} /> Execute Sell with Stop-Loss
            </Button>
          </Col>
        </Row>

        {/* Trade Form: Buy/Sell + Stop-Loss/Stop-Gain */}
        {showStopLossForm && (
          <Container className="mt-4 p-3 border rounded shadow-sm">
            <h4 className={actionType === 'buy' ? "text-success" : "text-danger"}>
              {actionType === 'buy' ? (
                <>
                  <FontAwesomeIcon icon={faShoppingCart} /> Buy with Stop-Loss
                </>
              ) : (
                <>
                  <FontAwesomeIcon icon={faExchangeAlt} /> Sell with Stop-Loss
                </>
              )}
            </h4>
            <Form onSubmit={handleStopLossSubmission}>
              <Row className="mb-3">
                {actionType === 'buy' && (
                  <>
                    <Col md={3}>
                      <Form.Group controlId="buyThreshold">
                        <Form.Label>Buy Threshold (≥)</Form.Label>
                        <Form.Control 
                          type="number" 
                          value={buyThreshold} 
                          onChange={(e) => setBuyThreshold(Number(e.target.value))} 
                        />
                      </Form.Group>
                    </Col>
                    <Col md={3}>
                      <Form.Group controlId="buyConditionType">
                        <Form.Label>Buy Strategy</Form.Label>
                        <Form.Select 
                          value={buyConditionType} 
                          onChange={(e) => setBuyConditionType(e.target.value)}
                        >
                          <option value="Fixed Value">Fixed Value</option>
                          <option value="Percentage">Percentage</option>
                          <option value="Points">Points</option>
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    <Col md={3}>
                      <Form.Group controlId="buyConditionValue">
                        <Form.Label>Buy Condition Value</Form.Label>
                        <Form.Control 
                          type="number" 
                          value={buyConditionValue} 
                          onChange={(e) => setBuyConditionValue(Number(e.target.value))} 
                        />
                      </Form.Group>
                    </Col>
                  </>
                )}
                {actionType === 'sell' && (
                  <>
                    <Col md={3}>
                      <Form.Group controlId="sellThreshold">
                        <Form.Label>Sell Threshold (≤)</Form.Label>
                        <Form.Control 
                          type="number" 
                          value={sellThreshold} 
                          onChange={(e) => setSellThreshold(Number(e.target.value))} 
                        />
                      </Form.Group>
                    </Col>
                    <Col md={3}>
                      <Form.Group controlId="sellConditionType">
                        <Form.Label>Sell Strategy</Form.Label>
                        <Form.Select 
                          value={sellConditionType} 
                          onChange={(e) => setSellConditionType(e.target.value)}
                        >
                          <option value="Fixed Value">Fixed Value</option>
                          <option value="Percentage">Percentage</option>
                          <option value="Points">Points</option>
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    <Col md={3}>
                      <Form.Group controlId="sellConditionValue">
                        <Form.Label>Sell Condition Value</Form.Label>
                        <Form.Control 
                          type="number" 
                          value={sellConditionValue} 
                          onChange={(e) => setSellConditionValue(Number(e.target.value))} 
                        />
                      </Form.Group>
                    </Col>
                  </>
                )}
              </Row>

              {/* User selection (checkboxes with limit 1–3) */}
              <Row className="mb-3">
                <Col>
                  <Form.Label>Select Users (1 to 3):</Form.Label>
                  {users.map((user, index) => (
                    <Form.Check
                      key={index}
                      type="checkbox"
                      label={user.username}
                      checked={selectedUsers.includes(user.username)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          if (selectedUsers.length < 3) {
                            setSelectedUsers([...selectedUsers, user.username]);
                          } else {
                            alert("⚠ You can only select up to 3 users.");
                          }
                        } else {
                          setSelectedUsers(selectedUsers.filter(u => u !== user.username));
                        }
                      }}
                    />
                  ))}
                </Col>
              </Row>

              <Row className="mb-3">
                <Col md={3}>
                  <Form.Group controlId="symbol">
                    <Form.Label>Symbol</Form.Label>
                    <Form.Control 
                      type="text" 
                      placeholder="Enter Stock Symbol" 
                      value={formData.symbol} 
                      onChange={(e) => setFormData({ ...formData, symbol: e.target.value })} 
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Row className="mb-3">
                <Col md={3}>
                  <Form.Group controlId="stopLossType">
                    <Form.Label>Stop-Loss/Stop-Gain Type</Form.Label>
                    <Form.Select 
                      value={stopLossType} 
                      onChange={(e) => setStopLossType(e.target.value)}
                    >
                      <option value="Fixed">Fixed</option>
                      <option value="Percentage">Percentage</option>
                      <option value="Points">Points</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={3}>
                  <Form.Group controlId="stopLossValue">
                    <Form.Label>Stop-Loss/Stop-Gain Value</Form.Label>
                    <Form.Control 
                      type="number" 
                      value={stopLossValue} 
                      onChange={(e) => setStopLossValue(Number(e.target.value))} 
                    />
                  </Form.Group>
                </Col>
                <Col md={3}>
                  <Form.Group controlId="pointsCondition">
                    <Form.Label>Points Condition</Form.Label>
                    <Form.Control 
                      type="number" 
                      value={pointsCondition} 
                      onChange={(e) => setPointsCondition(Number(e.target.value))} 
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Button 
                type="submit" 
                style={{ backgroundColor: '#007BA7', borderColor: '#007BA7', color: 'white' }}
                className="mt-3"
              >
                {actionType === 'buy' ? 'Place Order Buy with Stop-Loss' : 'Place Order Sell with Stop-Loss'}
              </Button>
            </Form>
          </Container>
        )}
      </Container>

      {/* Registration Modal */}
      <Modal show={showRegisterModal} onHide={() => setShowRegisterModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Register User</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {message.text && <Alert variant={message.type}>{message.text}</Alert>}
          <Form onSubmit={handleRegisterSubmit}>
            <Form.Group controlId="username">
              <Form.Label>Username</Form.Label>
              <Form.Control 
                type="text" 
                placeholder="Enter username" 
                value={formData.username} 
                onChange={(e) => setFormData({ ...formData, username: e.target.value })} 
                required 
              />
            </Form.Group>
            <Form.Group controlId="password">
              <Form.Label>Password</Form.Label>
              <Form.Control 
                type="password" 
                placeholder="Enter password" 
                value={formData.password} 
                onChange={(e) => setFormData({ ...formData, password: e.target.value })} 
                required 
              />
            </Form.Group>
            <Form.Group controlId="broker">
              <Form.Label>Broker</Form.Label>
              <Form.Select 
                value={formData.broker} 
                onChange={(e) => setFormData({ ...formData, broker: e.target.value })}
              >
                <option value="Angel">Angel</option>
                <option value="Zerodha">Zerodha</option>
              </Form.Select>
            </Form.Group>
            <Form.Group controlId="api_key">
              <Form.Label>API Key</Form.Label>
              <Form.Control 
                type="text" 
                placeholder="Enter API Key" 
                value={formData.api_key} 
                onChange={(e) => setFormData({ ...formData, api_key: e.target.value })} 
                required 
              />
            </Form.Group>
            <Form.Group controlId="totp_token">
              <Form.Label>TOTP Token</Form.Label>
              <Form.Control 
                type="text" 
                placeholder="Enter TOTP Token" 
                value={formData.totp_token} 
                onChange={(e) => setFormData({ ...formData, totp_token: e.target.value })} 
                required 
              />
            </Form.Group>
            <Form.Group controlId="default_quantity">
              <Form.Label>Default Quantity</Form.Label>
              <Form.Control 
                type="number" 
                placeholder="Enter Quantity" 
                value={formData.default_quantity} 
                onChange={(e) => setFormData({ ...formData, default_quantity: e.target.value })} 
                required 
              />
            </Form.Group>
            <Button variant="primary" type="submit" className="mt-3">
              Register
            </Button>
          </Form>
        </Modal.Body>
      </Modal>
    </>
  );
};

export default Landing;