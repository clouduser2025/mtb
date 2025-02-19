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
  faUser,               
  faUserTie,
  faChartLine,
  faDollarSign,
  faChartBar,
  faHourglassHalf,
  faBullseye,
  faMapMarkerAlt,
  faFileExcel
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
    password: "",  
    broker: "Angel",
    api_key: "",
    totp_token: "",
    default_quantity: "",  
    symbol: "",  
  });
  
  // Action type: 'buy' or 'sell'
  const [actionType, setActionType] = useState(null);
  const [showStopLossForm, setShowStopLossForm] = useState(false);

  // Thresholds and entry price
  const [buyThreshold, setBuyThreshold] = useState(100);
  const [sellThreshold, setSellThreshold] = useState(120);
  const [entryPrice, setEntryPrice] = useState(null);

  // Stop-loss and condition settings for BUY
  const [stopLossType, setStopLossType] = useState('Fixed'); 
  const [stopLossValue, setStopLossValue] = useState(95);
  const [buyConditionType, setBuyConditionType] = useState('Fixed Value'); 
  const [buyConditionValue, setBuyConditionValue] = useState(0);
  const [pointsCondition, setPointsCondition] = useState(0);
  const basePriceRef = useRef(null);

  // Stop-gain and condition settings for SELL
  const [sellConditionType, setSellConditionType] = useState('Fixed Value'); 
  const [sellConditionValue, setSellConditionValue] = useState(0);

  // LTP (Last Traded Price) settings
  const [exchange, setExchange] = useState("NSE");
  const [ltpSymbol, setLtpSymbol] = useState("");
  const [symbolToken, setSymbolToken] = useState("");
  const [ltpPrice, setLtpPrice] = useState(null);
  const [loadingLtp, setLoadingLtp] = useState(false);

  // New state for Excel data
  const [excelData, setExcelData] = useState([]);
  const [showExcelData, setShowExcelData] = useState(false);
  const [symbolForToken, setSymbolForToken] = useState('');
  const [tokenFetchResult, setTokenFetchResult] = useState(null);

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
      if (data.status) {
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

  const fetchTrades = async () => {
    try {
      const response = await fetch("https://ramdoot.onrender.com/api/get_trades");
      if (!response.ok) {
        throw new Error("Failed to fetch trades");
      }
      const data = await response.json();
      
      const updatedTrades = data.trades.map(trade => ({
        ...trade,
        user_role: trade.user_role || "Trader", 
      }));
  
      setOpenTrades(updatedTrades);
    } catch (error) {
      console.error("Error fetching trades:", error);
    }
  };

  const UserActionsDropdown = ({ setShowRegisterModal, setShowUsers, showUsers }) => {
    return (
      <Dropdown as={ButtonGroup}>
        <Dropdown.Toggle variant="primary" id="dropdown-basic" className="user-actions-dropdown">
          <FontAwesomeIcon icon={faUserCog} />
        </Dropdown.Toggle>
  
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

  // Fetch registered users on component mount
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
      setUsers(data.users);
    } catch (error) {
      console.error("Error fetching users:", error);
    }
  };

  const fetchSymbolToken = async () => {
    if (!symbolForToken) {
      alert("Please enter a symbol.");
      return;
    }
    
    try {
      const response = await fetch(`https://ramdoot.onrender.com/api/get_token/${symbolForToken}`);
      const data = await response.json();
      if (response.ok) {
        setTokenFetchResult(data);
      } else {
        alert(data.detail || "Failed to fetch token.");
        setTokenFetchResult(null);
      }
    } catch (error) {
      console.error("Error fetching token:", error);
      alert("Server error. Try again later.");
      setTokenFetchResult(null);
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
          password: formData.password,  
          broker: formData.broker,
          api_key: formData.api_key,
          totp_token: formData.totp_token,
          default_quantity: parseInt(formData.default_quantity, 10) || 1,
        }),
      });
  
      const data = await response.json();
  
      if (response.ok) {
        setMessage({ text: "User registered successfully!", type: "success" });
        fetchUsers(); 
        setFormData({
          username: "",
          password: "",  
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
      buy_threshold: buyThreshold,
      buy_condition_type: buyConditionType,
      buy_condition_value: buyConditionValue,
      stop_loss_type: stopLossType,
      stop_loss_value: stopLossValue,
      points_condition: pointsCondition
    };
  
    try {
      const response = await fetch('https://ramdoot.onrender.com/api/buy_trade', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tradeData),
      });

      if (response.ok) {
        const data = await response.json();
        let successMessages = [];
        let errorMessages = [];

        data.forEach(item => {
          if (item.status === "success") {
            successMessages.push(item.message);
          } else if (item.status === "error" || item.status === "skipped") {
            errorMessages.push(`${item.user}: ${item.message}`);
          }
        });

        if (successMessages.length > 0) {
          setMessage({ text: `Trade buy order placed successfully: ${successMessages.join(', ')}`, type: "success" });
        }
        if (errorMessages.length > 0) {
          setMessage(prev => ({
            text: `${prev.text || ''} Errors: ${errorMessages.join(', ')}`,
            type: prev.type === "success" ? "warning" : "danger"
          }));
        }

        setShowStopLossForm(false);
        fetchTrades();
      } else {
        setMessage({ text: "Failed to place trade order", type: "danger" });
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
          datafeed: window.TradingView.defaultDatafeed, 
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
    
      if (typeof tvWidgetRef.current.on !== "function") {
        console.error("TradingView widget is not initialized properly.");
        return;
      }
    
      tvWidgetRef.current.on("chart_ready", () => {
        const chart = tvWidgetRef.current.chart(); 
        const currentTime = Math.floor(Date.now() / 1000); 
    
        let priceOffset = {}; 
    
        trades.forEach((trade) => {
          const basePrice = trade.entry_price;
    
          if (!priceOffset[basePrice]) {
            priceOffset[basePrice] = 0;
          } else {
            priceOffset[basePrice] += 0.5; 
          }
    
          const userIcons = {
            "John": { icon: "👨‍💼", color: "🔵" },  
            "Alice": { icon: "👩‍💼", color: "🟢" },  
            "Bob": { icon: "🧑‍💻", color: "🟠" }   
          };
    
          const userData = userIcons[trade.username] || { icon: "🧑‍💻", color: "⚪" };
    
          chart.createShape(
            { time: currentTime, price: basePrice + priceOffset[basePrice] },
            {
              shape: trade.position_type === "LONG" ? "arrow_up" : "arrow_down",
              text: `${userData.color} ${userData.icon} ${trade.username}\n(${trade.user_role})`, 
              color: trade.position_type === "LONG" ? "green" : "red",
              disableUndo: true
            }
          );
        });
      });
    };
    
    useEffect(() => {
      if (tvWidgetRef.current) {
        updateMarkers(openTrades); 
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
    script.onload = callback; 
    document.body.appendChild(script);
  };

  // Function to fetch Excel data
  const fetchExcelData = async () => {
    try {
      const response = await fetch("https://ramdoot.onrender.com/api/get_excel_data");
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await response.json();
      // We only need the first four columns from the data
      const filteredData = data.data.map(item => ({
        symbol: item.symbol,
        token: item.token,
        name: item.name,
        expiry: item.expiry
      }));
      setExcelData(filteredData);
    } catch (error) {
      console.error("Failed to fetch excel data:", error);
      setMessage({ text: "Failed to fetch Excel data", type: "danger" });
    }
  };

  useEffect(() => {
    // Fetch Excel data when component mounts
    fetchExcelData();
  }, []);
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
                        <td>{user.broker}</td> 
                        <td>{user.default_quantity}</td> 
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

        {/* Active Trades Table */}
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
          <Col xs="auto">
            <Button onClick={() => setShowExcelData(!showExcelData)} className="gradient-button btn-excel">
              <FontAwesomeIcon icon={faFileExcel} /> Excel Data
            </Button>
          </Col>
        </Row>

        {/* LTP Section */}
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
                <Button type="submit" variant="primary" className="custom-btn mt-4">Fetch LTP</Button>
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
                <Col md={3}>
                  <Form.Group controlId="stopLossType">
                    <Form.Label>Stop-Loss Type</Form.Label>
                    <Form.Select 
                      value={stopLossType} 
                      onChange={(e) => setStopLossType(e.target.value)}
                    >
                      <option value="Fixed">Fixed</option>
                      <option value="Trailing">Trailing</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={3}>
                  <Form.Group controlId="stopLossValue">
                    <Form.Label>Stop-Loss Value</Form.Label>
                    <Form.Control 
                      type="number" 
                      value={stopLossValue} 
                      onChange={(e) => setStopLossValue(Number(e.target.value))} 
                    />
                  </Form.Group>
                </Col>
                {stopLossType === 'Trailing' && (
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
                )}
              </Row>
              <Row className="mb-3">
                <Col md={6}>
                  <h5>Select Users (1-3):</h5>
                  {users.map((user, index) => (
                    <Form.Check 
                      key={index}
                      type="checkbox"
                      id={`user-${user.username}`}
                      label={`${user.username} - ${user.role || "Trader"}`}
                      checked={selectedUsers.includes(user.username)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          if (selectedUsers.length < 3) {
                            setSelectedUsers(prev => [...prev, user.username]);
                          } else {
                            e.target.checked = false; // Prevents selection if more than 3 users are selected
                          }
                        } else {
                          setSelectedUsers(selectedUsers.filter(u => u !== user.username));
                        }
                      }}
                    />
                  ))}
                </Col>
                <Col md={6}>
                  <Form.Group controlId="symbol">
                    <Form.Label>Symbol</Form.Label>
                    <Form.Control 
                      type="text" 
                      value={formData.symbol} 
                      onChange={(e) => setFormData({...formData, symbol: e.target.value})} 
                      required 
                    />
                  </Form.Group>
                </Col>
              </Row>
              <Row className="mb-3">
                <Col md={6}>
                  <Button type="submit" variant="primary" className="gradient-button">
                    {actionType === 'buy' ? "Submit Buy Order" : "Submit Sell Order"}
                  </Button>
                </Col>
                <Col md={6} className="text-end">
                  <Button variant="secondary" onClick={() => setShowStopLossForm(false)}>
                    Cancel
                  </Button>
                </Col>
              </Row>
            </Form>
          </Container>
        )}

        {/* Excel Data Display */}
        {showExcelData && (
          <Container className="mt-5 p-4 excel-table-container shadow-lg rounded bg-white">
            <h3 className="text-center mb-4 text-dark fw-bold">
              <FontAwesomeIcon icon={faFileExcel} className="me-2 text-success" /> Excel Data
            </h3>
            <div className="table-responsive">
              <Table striped bordered hover className="excel-table shadow-sm">
                <thead className="text-center">
                  <tr>
                    <th className="bg-primary text-white">Symbol</th>
                    <th className="bg-success text-white">Token</th>
                    <th className="bg-info text-white">Name</th>
                    <th className="bg-warning text-dark">Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {excelData.length > 0 ? (
                    excelData.map((item, index) => (
                      <tr key={index}>
                        <td>{item.symbol}</td>
                        <td>{item.token}</td>
                        <td>{item.name}</td>
                        <td>{item.expiry}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="4" className="text-muted text-center">No data available.</td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          </Container>
        )}

        {/* Token Fetch Section */}
        <Container className="mt-4 p-3 border rounded shadow-sm">
          <h4 className="text-info">🔑 Fetch Token for Symbol</h4>
          <Form onSubmit={(e) => { e.preventDefault(); fetchSymbolToken(); }}>
            <Row className="mb-3">
              <Col md={6}>
                <Form.Group controlId="symbolForToken">
                  <Form.Label>Enter Symbol</Form.Label>
                  <Form.Control 
                    type="text" 
                    placeholder="e.g. RELIANCE" 
                    value={symbolForToken} 
                    onChange={(e) => setSymbolForToken(e.target.value)} 
                    required 
                  />
                </Form.Group>
              </Col>
              <Col md={6} className="d-flex align-items-end">
                <Button type="submit" variant="info" className="gradient-button">Fetch Token</Button>
              </Col>
            </Row>
          </Form>
          {tokenFetchResult && (
            <Alert variant="info">
              Token for <strong>{tokenFetchResult.symbol}</strong>: {tokenFetchResult.token}
            </Alert>
          )}
        </Container>

        {/* Message Display */}
        {message.text && (
          <Alert variant={message.type} onClose={() => setMessage({ text: "", type: "" })} dismissible>
            {message.text}
          </Alert>
        )}

      </Container>

      {/* Registration Modal */}
      <Modal show={showRegisterModal} onHide={() => setShowRegisterModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Register New User</Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleRegisterSubmit}>
          <Modal.Body>
            <Form.Group className="mb-3" controlId="username">
              <Form.Label>Username</Form.Label>
              <Form.Control 
                type="text" 
                placeholder="Enter username" 
                value={formData.username} 
                onChange={(e) => setFormData({...formData, username: e.target.value})} 
                required 
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="password">
              <Form.Label>Password</Form.Label>
              <Form.Control 
                type="password" 
                placeholder="Enter password" 
                value={formData.password} 
                onChange={(e) => setFormData({...formData, password: e.target.value})} 
                required 
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="broker">
              <Form.Label>Broker</Form.Label>
              <Form.Select 
                value={formData.broker} 
                onChange={(e) => setFormData({...formData, broker: e.target.value})}
              >
                <option value="Angel">Angel</option>
                <option value="Zerodha">Zerodha</option>
                <option value="Upstox">Upstox</option>
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3" controlId="api_key">
              <Form.Label>API Key</Form.Label>
              <Form.Control 
                type="text" 
                placeholder="Enter API Key" 
                value={formData.api_key} 
                onChange={(e) => setFormData({...formData, api_key: e.target.value})} 
                required 
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="totp_token">
              <Form.Label>TOTP Token</Form.Label>
              <Form.Control 
                type="text" 
                placeholder="Enter TOTP Token" 
                value={formData.totp_token} 
                onChange={(e) => setFormData({...formData, totp_token: e.target.value})} 
                required 
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="default_quantity">
              <Form.Label>Default Quantity</Form.Label>
              <Form.Control 
                type="number" 
                placeholder="Enter default quantity" 
                value={formData.default_quantity} 
                onChange={(e) => setFormData({...formData, default_quantity: e.target.value})} 
                required 
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowRegisterModal(false)}>
              Close
            </Button>
            <Button variant="primary" type="submit">
              Register
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
};

export default Landing;